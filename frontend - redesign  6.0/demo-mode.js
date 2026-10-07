/* ──────────────────────────────────────────────────────────────────────
 * Demo Mode — fallback when backend Lambdas are not deployed.
 *
 * Activates automatically when any URL in window.STREAM_URLS is still the
 * `__URL_*__` placeholder (i.e. the GitHub Actions deploy step never ran
 * to inject real Lambda URLs — typical for Vercel / Netlify / GitHub Pages
 * static-only hosting).
 *
 * When active:
 *   1. Replaces every placeholder URL with `https://demo.local/<feature>`
 *      so the existing UI code happily believes the backend exists.
 *   2. Monkey-patches window.fetch — calls to `https://demo.local/*` are
 *      intercepted and answered with canned sample content. Real fetches
 *      to other hosts pass through untouched.
 *   3. Drops a small banner at the top of the page so judges/visitors
 *      know they're looking at the UI showcase, not the live AI.
 *
 * On AWS-deployed builds the placeholders are sed-replaced by the deploy
 * workflow → isDemoMode is false → this file becomes a no-op.
 * ────────────────────────────────────────────────────────────────────── */

(function () {
  if (!window.STREAM_URLS) return;

  // ── Detect demo mode ────────────────────────────────────────────────
  const urls = window.STREAM_URLS;
  const isDemoMode = Object.values(urls).some(
    u => !u || typeof u !== 'string' || u.startsWith('__URL_')
  );
  if (!isDemoMode) return;

  // Swap every placeholder for a sentinel URL so the existing checks
  // (`startsWith('__URL_')`) pass and the rest of the UI proceeds.
  for (const key of Object.keys(urls)) {
    if (!urls[key] || urls[key].startsWith('__URL_')) {
      urls[key] = 'https://demo.local/' + key;
    }
  }
  window.__DEMO_MODE__ = true;

  // ── Banner ──────────────────────────────────────────────────────────
  function injectBanner() {
    if (document.getElementById('demo-mode-banner')) return;
    const bar = document.createElement('div');
    bar.id = 'demo-mode-banner';
    bar.innerHTML =
      '🎬 <strong>Demo Mode</strong> — showcasing UI with sample content. ' +
      'Connect to AWS for the live AI experience.';
    bar.style.cssText = [
      'position:sticky', 'top:0', 'z-index:9999',
      'background:linear-gradient(90deg,#ff8c00,#ff5e7e)',
      'color:#fff', 'font:600 13px/1.4 system-ui,-apple-system,sans-serif',
      'padding:8px 14px', 'text-align:center',
      'box-shadow:0 2px 6px rgba(0,0,0,.18)',
    ].join(';');
    document.body.insertBefore(bar, document.body.firstChild);
  }
  if (document.body) injectBanner();
  else document.addEventListener('DOMContentLoaded', injectBanner);

  // ── Helpers ─────────────────────────────────────────────────────────
  const enc = new TextEncoder();

  /** Build a streaming Response that emits `text` word-by-word with a delay. */
  function streamResponse(text, perChunkMs = 20) {
    const tokens = text.match(/\S+\s*|\s+/g) || [text];
    let i = 0;
    const stream = new ReadableStream({
      async pull(controller) {
        if (i >= tokens.length) { controller.close(); return; }
        // Emit 2-3 tokens per pull for a snappier feel
        const burst = Math.min(3, tokens.length - i);
        for (let n = 0; n < burst; n++) controller.enqueue(enc.encode(tokens[i++]));
        await new Promise(r => setTimeout(r, perChunkMs));
      }
    });
    return new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  /** Build a JSON Response with an optional fake-latency delay. */
  async function jsonResponse(data, delayMs = 600) {
    await new Promise(r => setTimeout(r, delayMs));
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /** SVG → base64 PNG-ish placeholder for the image generator. */
  function placeholderImageB64(label) {
    const safe = String(label || 'Demo').replace(/[<>&"']/g, '').slice(0, 40);
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">
        <defs>
          <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#0ea5e9"/>
            <stop offset="100%" stop-color="#a78bfa"/>
          </linearGradient>
        </defs>
        <rect width="400" height="300" fill="url(#g)"/>
        <text x="50%" y="48%" text-anchor="middle" fill="#fff"
              font-family="system-ui,sans-serif" font-size="22" font-weight="700">
          🎬 Demo Image
        </text>
        <text x="50%" y="62%" text-anchor="middle" fill="#fff"
              font-family="system-ui,sans-serif" font-size="14" opacity="0.9">
          ${safe}
        </text>
      </svg>`;
    // btoa requires latin-1 safe; the svg is plain ASCII so we're fine.
    return btoa(svg.trim());
  }

  // ── Canned content (kept short to load fast) ────────────────────────
  const SAMPLE = {
    chapterList: (subject, level) => ({
      data: [
        { chapterNumber: '1', title: 'Introduction to ' + subject,
          shortDescription: 'Foundational concepts and the scientific method as applied to ' + subject + '.' },
        { chapterNumber: '2', title: 'Cells and Living Systems',
          shortDescription: 'Cell structure, organelles, and the building blocks of life.' },
        { chapterNumber: '3', title: 'Energy and Reactions',
          shortDescription: 'How energy is transferred, stored, and transformed in physical and biological systems.' },
        { chapterNumber: '4', title: 'Matter and Its Properties',
          shortDescription: 'States of matter, particle theory, and physical/chemical changes.' },
        { chapterNumber: '5', title: 'Forces and Motion',
          shortDescription: 'Newton\'s laws, friction, and everyday motion observations.' },
        { chapterNumber: '6', title: 'Ecosystems and Environment',
          shortDescription: 'Interactions between organisms and their environment, food chains, conservation.' },
        { chapterNumber: '7', title: 'The Human Body',
          shortDescription: 'Major organ systems and how they work together to keep us alive.' },
        { chapterNumber: '8', title: 'Earth and Space',
          shortDescription: 'Planet Earth, weather systems, and our place in the solar system.' },
      ],
    }),

    chapterDetail: (chapterTitle) => ({
      data: {
        title: chapterTitle || 'Sample Chapter',
        subtopics: [
          'Key vocabulary and definitions',
          'Core processes and mechanisms',
          'Real-world examples in Malaysia',
          'Common SPM exam question patterns',
        ],
        learningObjectives: [
          'Define and explain the main concepts of this chapter.',
          'Apply the concepts to solve practical problems.',
          'Identify connections to other science topics.',
          'Recognize common misconceptions and correct them.',
        ],
        keyConcepts: [
          'The scientific method as a structured way of learning',
          'Observation, hypothesis, experiment, conclusion',
          'Variables: independent, dependent, controlled',
          'Importance of safe lab practice',
        ],
        keyTerms: [
          { term: 'Hypothesis', definition: 'A testable prediction about how variables relate.' },
          { term: 'Variable', definition: 'A factor that can change in an experiment.' },
          { term: 'Conclusion', definition: 'A statement of what the experiment shows about the hypothesis.' },
        ],
      },
    }),

    experimentValidate: (topic) => ({
      valid: true,
      summary:
        'This is a school-appropriate experiment on "' + topic + '". The lab guide will cover ' +
        'the aim, materials, step-by-step procedure, expected observations, and safety notes.',
    }),

    experimentNodeMap: (topic) => ({
      topic_title: topic + ' Experiment',
      sections: {
        objective:
          '## 🎯 Objective\n\n' +
          'To investigate ' + topic + ' and observe the key scientific principles involved.\n',
        materials:
          '## 🧰 Materials\n\n' +
          '- Standard lab beakers (250 ml)\n' +
          '- Distilled water\n' +
          '- Thermometer\n' +
          '- Stopwatch\n' +
          '- Safety goggles & lab coat\n',
        safety:
          '## ⚠️ Safety\n\n' +
          '- Wear safety goggles throughout the experiment.\n' +
          '- Tie back long hair; avoid loose clothing near heat sources.\n' +
          '- Never taste or smell chemicals directly.\n' +
          '- Report any spillage to the supervisor immediately.\n',
        procedure:
          '## 📝 Procedure\n\n' +
          '1. Set up the apparatus on a stable bench.\n' +
          '2. Record the initial conditions (temperature, volume, mass).\n' +
          '3. Carry out the reaction or observation slowly and carefully.\n' +
          '4. Record observations every 30 seconds for 5 minutes.\n' +
          '5. Clean up the workspace once observations are complete.\n',
        expected_results:
          '## 📊 Expected Results\n\n' +
          'You should see a measurable change linked to the independent variable. ' +
          'Record values in a table and plot a graph to visualize the trend.\n',
        scientific_explanation:
          '## 🔬 The Science Behind It\n\n' +
          'This experiment demonstrates how observable changes are linked to underlying ' +
          'physical and chemical principles. By systematically varying one factor at a time, ' +
          'students isolate cause-and-effect relationships — the heart of scientific method.\n',
        real_life_applications:
          '## 🌍 Real-Life Applications\n\n' +
          '- Industrial processes that depend on this principle\n' +
          '- Everyday situations where the effect can be observed\n' +
          '- Medical or environmental applications relevant to Malaysia\n',
        summary:
          '## ✅ Summary\n\n' +
          'A short, structured experiment that builds scientific reasoning, safe lab habits, ' +
          'and the ability to connect theory to observation. *— Demo content. Connect to AWS ' +
          'Bedrock for a topic-tailored guide.*\n',
      },
    }),

    quizOutline: (topic, difficulty) =>
      topic.toUpperCase() + ' — ' + difficulty.toUpperCase() + ' QUIZ OUTLINE || Sample\n\n' +
      '1. Definition of key terms (2 questions)\n' +
      '2. Basic concept recognition (3 questions)\n' +
      '3. Application to simple scenarios (3 questions)\n' +
      '4. Comparison and contrast (1 question)\n' +
      '5. Critical thinking / reasoning (1 question)\n\n' +
      'Suggested time: 15 minutes. Coverage matches the SPM syllabus scope.\n',

    quizGenerate: (meta) => {
      const t = meta.topic || 'Science';
      const make = (stem, A, B, C, D, correct, explain) => ({
        question_stem: stem,
        options: { A: A, B: B, C: C, D: D },
        correct_answer: correct,
        explanation: explain,
      });
      return {
        questions: [
          make(
            'Which best describes the topic "' + t + '" at the ' + (meta.difficulty || 'standard') + ' level?',
            'A foundational concept in the syllabus',
            'Only an advanced university topic',
            'A purely theoretical idea with no experiments',
            'Not part of any science syllabus',
            'A',
            'This topic appears in the standard science syllabus and is typically covered with both theory and practical work.'
          ),
          make(
            'What is the first step of the scientific method?',
            'Drawing a conclusion',
            'Forming a hypothesis',
            'Making an observation',
            'Publishing results',
            'C',
            'Observation comes first — you notice something interesting, then form a hypothesis to explain it.'
          ),
          make(
            'Which variable is changed deliberately in an experiment?',
            'Dependent variable',
            'Controlled variable',
            'Independent variable',
            'Random variable',
            'C',
            'The independent variable is the one you change on purpose to see its effect on the dependent variable.'
          ),
          make(
            'Why are controlled variables important?',
            'They make the experiment faster',
            'They keep other factors constant so the result is fair',
            'They are the same as the answer',
            'They only matter in biology',
            'B',
            'Controlled variables are kept constant so any change you see in the result must be due to the independent variable.'
          ),
          make(
            'What is the safest first action if a chemical spills on your skin?',
            'Ignore it and continue',
            'Wipe with a dry tissue',
            'Rinse with plenty of running water',
            'Apply soap immediately',
            'C',
            'Rinsing with plenty of water dilutes and removes the chemical. Tell the supervisor immediately.'
          ),
        ],
      };
    },

    tutorReply: (msg) =>
      'Great question! Let me break this down step by step.\n\n' +
      'First, think about what you already know about the topic. Try to recall any ' +
      'definitions or examples from class.\n\n' +
      'Next, look at the question carefully. What is it actually asking you to compare, ' +
      'explain, or calculate? Underlining keywords often helps.\n\n' +
      'Finally, build your answer in small steps. State the concept, give an example, ' +
      'then connect it back to the question.\n\n' +
      'Try writing your first attempt and I can give feedback on the next message!\n\n' +
      '_(Demo response — connect to AWS Bedrock for personalized AI tutoring.)_',

    safetyReport: (p) =>
      '# Safety Briefing — ' + (p.experiment || 'this experiment') + '\n\n' +
      '## ⚠️ Key Hazards\n' +
      '- **Chemical splash** — wear goggles at all times.\n' +
      '- **Sharp glassware** — handle beakers and test tubes carefully.\n' +
      '- **Heat sources** — keep flammables away from the bunsen burner.\n\n' +
      '## ✅ Before You Start\n' +
      '1. Tie back long hair and roll up loose sleeves.\n' +
      '2. Inspect glassware for cracks; replace damaged items.\n' +
      '3. Identify the nearest eyewash station and fire blanket.\n\n' +
      '## 🧪 During the Experiment\n' +
      '- Never leave a heat source unattended.\n' +
      '- Add acid to water, never water to acid.\n' +
      '- Label all containers clearly.\n\n' +
      '## 🚨 If Something Goes Wrong\n' +
      '- **Skin contact**: rinse with plenty of running water for 10+ minutes.\n' +
      '- **Eye splash**: use the eyewash station immediately.\n' +
      '- **Fire**: smother with a fire blanket; do not use water on chemical fires.\n\n' +
      '*— Demo safety brief. Connect to AWS Bedrock for an experiment-specific report.*\n',

    whatIfTimeline: (p) =>
      '# What If: ' + p.scenario + '\n\n' +
      '## ⏱️ T = 0s\n' +
      'The scenario begins. Initial conditions are set and the system is at rest.\n\n' +
      '## ⏱️ T = 5s\n' +
      'The first observable changes appear. Energy starts to redistribute, ' +
      'temperature or pressure begins to shift.\n\n' +
      '## ⏱️ T = 30s\n' +
      'The reaction or process reaches its peak intensity. Key indicators ' +
      '(color, sound, motion) are at their strongest.\n\n' +
      '## ⏱️ T = 2 min\n' +
      'The system begins to settle as energy dissipates. Most visible changes have occurred.\n\n' +
      '## ⏱️ T = 10 min\n' +
      'A new equilibrium is reached. The final state can be analyzed and compared ' +
      'to the initial conditions.\n\n' +
      '## 📚 The Science\n' +
      'This scenario illustrates how energy and matter follow predictable laws even ' +
      'when the setting is imaginary. Real-world physics still governs the outcome.\n\n' +
      '*— Demo timeline. Connect to AWS Bedrock for a scenario-tailored simulation.*\n',

    imageGenerator: (p) => ({
      explanation:
        '# ' + (p.concept || 'Demo Concept') + '\n\n' +
        'This is a demo image generated locally without the AI backend. ' +
        'The ' + (p.style || 'illustrated') + ' style highlights the core idea of ' +
        '"' + p.concept + '" at a ' + (p.detail || 'standard') + ' level of detail.\n\n' +
        'When connected to AWS Bedrock, this panel renders a Stable Diffusion image ' +
        'tuned to the chosen subject and education level.',
      image_base64: placeholderImageB64(p.concept || 'Demo'),
    }),

    flashcardDeck: (p) => {
      const topic = p.topic || p.chapter || 'Science';
      const cards = [
        { front: 'What is the main idea of ' + topic + '?',
          back: 'A foundational concept in the syllabus that explains how observable phenomena relate to underlying scientific principles.',
          tags: ['concept'] },
        { front: 'Define: hypothesis',
          back: 'A testable prediction about how variables in an experiment relate to each other.',
          tags: ['vocabulary'] },
        { front: 'Independent vs dependent variable?',
          back: 'Independent is changed by the experimenter; dependent is measured to see the effect.',
          tags: ['method'] },
        { front: 'Why wear safety goggles in the lab?',
          back: 'To protect eyes from chemical splashes, flying debris, and bright light during reactions.',
          tags: ['safety'] },
        { front: 'What is a controlled variable?',
          back: 'A factor kept constant during an experiment so that only the independent variable affects the result.',
          tags: ['method'] },
        { front: 'First aid for chemical skin contact?',
          back: 'Rinse with plenty of running water for at least 10 minutes and inform the supervisor.',
          tags: ['safety'] },
        { front: 'Why repeat an experiment?',
          back: 'To check the result is reliable and not due to a one-off error or random chance.',
          tags: ['method'] },
        { front: 'What is an observation?',
          back: 'Information collected directly from your senses or instruments during an experiment.',
          tags: ['concept'] },
      ];
      return { cards: cards.slice(0, p.num_cards || 8) };
    },

    scientificObjectOverview: (p) =>
      '# ' + (p.object || 'Sample Object') + '\n\n' +
      'A short overview of "' + p.object + '" at a ' + (p.level || 'secondary school') + ' level. ' +
      'This object is commonly studied in ' + (p.subject || 'science') + ' to illustrate key principles ' +
      'such as structure, function, and real-world application.\n',

    scientificObjectNarrative: (p) =>
      '## How it works\n\n' +
      'The ' + (p.object || 'object') + ' demonstrates fundamental scientific principles through ' +
      'its design and behavior. Students can examine it to understand both the theory and ' +
      'practical implications.\n\n' +
      '## Why it matters\n\n' +
      'Understanding the ' + (p.object || 'object') + ' helps build intuition for related concepts ' +
      'that appear later in the syllabus.\n',
  };

  // ── Router ──────────────────────────────────────────────────────────
  async function demoRoute(feature, body) {
    const b = body || {};
    switch (feature) {
      case 'chapter_assistant':
        if (b.action === 'detail') return jsonResponse(SAMPLE.chapterDetail(b.chapter_title));
        return jsonResponse(SAMPLE.chapterList(b.subject || 'Science', b.level || 'SPM'));

      case 'experiment_guide':
        if (b.mode === 'validate') return jsonResponse(SAMPLE.experimentValidate(b.topic || 'an experiment'));
        return jsonResponse(SAMPLE.experimentNodeMap(b.topic || 'a science topic'), 1200);

      case 'science_quiz':
        if (b.action === 'generate') return jsonResponse(SAMPLE.quizGenerate(b));
        return streamResponse(SAMPLE.quizOutline(b.topic || 'Science', b.difficulty || 'medium'), 20);

      case 'science_tutor':
        return streamResponse(SAMPLE.tutorReply(b.message || ''), 18);

      case 'safety_assistant':
        return streamResponse(SAMPLE.safetyReport(b), 20);

      case 'what_happens_if':
        return streamResponse(SAMPLE.whatIfTimeline(b), 22);

      case 'image_generator':
        return jsonResponse(SAMPLE.imageGenerator(b), 900);

      case 'flashcard_generator':
        return jsonResponse(SAMPLE.flashcardDeck(b), 800);

      case 'scientific_object_generator':
        if (b.mode === 'image') {
          return jsonResponse({ image_base64: placeholderImageB64(b.object || 'Demo') }, 700);
        }
        if (b.mode === 'narrative') return streamResponse(SAMPLE.scientificObjectNarrative(b), 22);
        return streamResponse(SAMPLE.scientificObjectOverview(b), 22);

      case 'feedback_collector':
        return jsonResponse({ ok: true, message: 'Feedback recorded (demo mode)' }, 200);

      default:
        return jsonResponse({ error: 'Unknown demo feature: ' + feature }, 100);
    }
  }

  // ── Patch fetch ─────────────────────────────────────────────────────
  const originalFetch = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    const url = (typeof input === 'string') ? input : (input && input.url) || '';
    if (url.indexOf('https://demo.local/') !== 0) {
      return originalFetch(input, init);
    }
    const feature = url.replace('https://demo.local/', '').split(/[/?#]/)[0];
    let body = {};
    try {
      if (init && typeof init.body === 'string') body = JSON.parse(init.body);
    } catch (_) { /* non-JSON body — fine, leave as {} */ }
    try {
      return await demoRoute(feature, body);
    } catch (err) {
      console.warn('[demo-mode] route error:', err);
      return new Response(JSON.stringify({ error: String(err) }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      });
    }
  };
})();
