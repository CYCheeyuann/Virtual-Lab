"""Lightweight eval harness for the 9 Lambdas.

Two modes:

  python -m eval.run                 # offline smoke (uses canned mock outputs)
  python -m eval.run --live          # real Bedrock; requires AWS credentials

Each invocation:

  1. Loads sample inputs from `eval/samples/<lambda>.json`.
  2. Sends each sample through the Lambda's Flask test client.
  3. Validates the response against the schema declared in the sample.
  4. Writes a result JSON file under `eval/results/<timestamp>/<lambda>.json`
     containing the input, output, schema_pass flag, and a blank scoring
     template for human review (correctness / structural_completeness /
     teaching_clarity / safety / consistency).

The harness reuses the same Bedrock mock fixture used by pytest, so smoke
mode is deterministic and CI-safe. Live mode bypasses the mock entirely
and lets boto3 talk to Bedrock.

Exit code is 0 if every sample produces an HTTP-2xx response and (when a
schema is declared) passes schema validation. Non-zero otherwise — that's
the gate the deploy workflow uses.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import traceback
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import MagicMock

# Force UTF-8 stdout on Windows so result summaries with non-ASCII chars
# don't crash on cp1252.
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    except Exception:
        pass

ROOT = Path(__file__).resolve().parent.parent
LAMBDAS_DIR = ROOT / "lambdas"
SHARED_DIR = LAMBDAS_DIR / "shared"
SAMPLES_DIR = Path(__file__).parent / "samples"
RESULTS_DIR = Path(__file__).parent / "results"

# Make shared modules importable.
sys.path.insert(0, str(SHARED_DIR))
# Allow `from tests.schemas import lookup` for schema validation.
sys.path.insert(0, str(ROOT))

# ── Lambda loading (shared with pytest conftest) ──────────────────────────
import importlib.util

from jsonschema import ValidationError, validate  # noqa: E402

from tests.schemas import lookup as schema_lookup  # noqa: E402

_LOADED: dict = {}


def load_lambda(name):
    if name in _LOADED:
        return _LOADED[name]
    path = LAMBDAS_DIR / name / "app.py"
    if not path.exists():
        raise FileNotFoundError(path)
    spec = importlib.util.spec_from_file_location(f"_eval_lambda_{name}", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    _LOADED[name] = module
    return module


# ── Mock Bedrock for offline mode ─────────────────────────────────────────
def _bedrock_mock_for(canned_text=None, canned_image=None, canned_chunks=None):
    """Build a MagicMock bedrock-runtime client with canned responses."""
    mock = MagicMock()

    def _invoke_model_response():
        if canned_image is not None:
            payload = {"images": [canned_image]}
        else:
            payload = {"content": [{"type": "text", "text": canned_text or ""}]}
        body = MagicMock()
        body.read.return_value = json.dumps(payload).encode()
        return {"body": body}

    def _stream_response():
        chunks = canned_chunks or []
        events = []
        for c in chunks:
            chunk_data = {
                "type": "content_block_delta",
                "delta": {"type": "text_delta", "text": c},
            }
            events.append({"chunk": {"bytes": json.dumps(chunk_data).encode()}})
        return {"body": iter(events)}

    mock.invoke_model.return_value = _invoke_model_response()
    mock.invoke_model_with_response_stream.return_value = _stream_response()
    return mock


def _install_mock(mock):
    """Patch boto3.client to return our mock; reset cached client globals."""
    import boto3
    boto3.client = lambda *a, **kw: mock  # type: ignore[assignment]

    import bedrock_stream
    bedrock_stream._client = None

    for mod_name in (
        "_eval_lambda_image_generator",
        "_eval_lambda_scientific_object_generator",
    ):
        mod = sys.modules.get(mod_name)
        if mod is not None:
            if hasattr(mod, "_text_client"):
                mod._text_client = None
            if hasattr(mod, "_image_client"):
                mod._image_client = None


# ── Sample runner ─────────────────────────────────────────────────────────
def _run_one_sample(lambda_name, sample, *, live):
    """Drive a single sample through a Lambda; return a result dict."""
    mod = load_lambda(lambda_name)
    client = mod.app.test_client()

    if not live:
        canned = sample.get("canned", {})
        mock = _bedrock_mock_for(
            canned_text=canned.get("text"),
            canned_image=canned.get("image"),
            canned_chunks=canned.get("chunks"),
        )
        # For the image generator, two invoke_model calls happen (Claude
        # then Stability). Provide a side_effect chain when supplied.
        chain = canned.get("invoke_chain")
        if chain:
            sequence = []
            for step in chain:
                if step.get("kind") == "image":
                    body = MagicMock()
                    body.read.return_value = json.dumps({"images": [step["image"]]}).encode()
                    sequence.append({"body": body})
                else:
                    body = MagicMock()
                    body.read.return_value = json.dumps(
                        {"content": [{"type": "text", "text": step.get("text", "")}]}
                    ).encode()
                    sequence.append({"body": body})
            mock.invoke_model.side_effect = sequence
        _install_mock(mock)

    body = sample["request"]
    try:
        resp = client.post("/", json=body)
        status = resp.status_code
        if resp.is_json:
            output = resp.get_json()
        else:
            output = resp.get_data(as_text=True)
    except Exception as e:
        return {
            "lambda": lambda_name,
            "sample_id": sample.get("id"),
            "input": body,
            "status": 0,
            "output": None,
            "schema_pass": False,
            "error": f"{type(e).__name__}: {e}",
            "trace": traceback.format_exc(),
            "scoring": _empty_scoring_template(),
        }

    schema_name = sample.get("schema")
    schema_pass = None
    schema_error = None
    if schema_name:
        schema = schema_lookup(schema_name)
        if schema is None:
            schema_pass = False
            schema_error = f"unknown schema name: {schema_name}"
        elif not isinstance(output, (dict, list)):
            schema_pass = False
            schema_error = "non-JSON output for declared schema"
        else:
            try:
                validate(output, schema)
                schema_pass = True
            except ValidationError as e:
                schema_pass = False
                schema_error = e.message

    return {
        "lambda": lambda_name,
        "sample_id": sample.get("id"),
        "input": body,
        "status": status,
        "output": output,
        "schema_pass": schema_pass,
        "schema_error": schema_error,
        "scoring": _empty_scoring_template(),
    }


def _empty_scoring_template():
    """Each scoring axis is 0–5 per the rubric in docs/ai-output-rubric.md."""
    return {
        "correctness":             None,
        "structural_completeness": None,
        "teaching_clarity":        None,
        "safety":                  None,
        "consistency":             None,
        "notes":                   "",
        "reviewer":                "",
    }


# ── Runner entrypoint ─────────────────────────────────────────────────────
def run(targets, *, live, smoke):
    timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    out_dir = RESULTS_DIR / timestamp
    out_dir.mkdir(parents=True, exist_ok=True)

    overall_pass = True
    summary = []

    for lambda_name in targets:
        sample_path = SAMPLES_DIR / f"{lambda_name}.json"
        if not sample_path.exists():
            print(f"[skip] {lambda_name}: no samples file")
            continue
        with open(sample_path, encoding="utf-8") as f:
            samples = json.load(f)

        if smoke:
            samples = samples[:1]  # one sample per Lambda for the CI gate

        results = []
        for sample in samples:
            result = _run_one_sample(lambda_name, sample, live=live)
            results.append(result)
            ok = (200 <= result["status"] < 300) and (result["schema_pass"] is not False)
            tick = "[PASS]" if ok else "[FAIL]"
            print(f"  {tick} {lambda_name}/{result['sample_id']}  status={result['status']}  schema_pass={result['schema_pass']}")
            if not ok:
                overall_pass = False
                if result.get("schema_error"):
                    print(f"     schema_error: {result['schema_error']}")
                if result.get("error"):
                    print(f"     error:        {result['error']}")

        out_file = out_dir / f"{lambda_name}.json"
        out_file.write_text(json.dumps(results, indent=2), encoding="utf-8")
        summary.append({"lambda": lambda_name, "samples": len(results), "file": str(out_file)})

    summary_file = out_dir / "_summary.json"
    summary_file.write_text(json.dumps({
        "timestamp": timestamp,
        "live": live,
        "smoke": smoke,
        "overall_pass": overall_pass,
        "lambdas": summary,
    }, indent=2), encoding="utf-8")

    print(f"\nResults written to: {out_dir}")
    print(f"Overall: {'PASS' if overall_pass else 'FAIL'}")
    return 0 if overall_pass else 1


def main():
    parser = argparse.ArgumentParser(description="Lambda eval harness")
    parser.add_argument(
        "--lambda", dest="only", action="append", default=None,
        help="run a single Lambda (may repeat)",
    )
    parser.add_argument(
        "--live", action="store_true",
        help="hit real Bedrock instead of using canned mock outputs",
    )
    parser.add_argument(
        "--smoke", action="store_true",
        help="only run the first sample per Lambda (used by CI gate)",
    )
    args = parser.parse_args()

    if args.only:
        targets = args.only
    else:
        # Default: every Lambda that has a samples file.
        targets = sorted(p.stem for p in SAMPLES_DIR.glob("*.json"))

    if args.live and os.environ.get("AWS_ACCESS_KEY_ID") is None:
        print("--live requires AWS credentials in the environment.")
        return 2

    return run(targets, live=args.live, smoke=args.smoke)


if __name__ == "__main__":
    sys.exit(main())
