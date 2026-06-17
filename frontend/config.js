/* Streaming Lambda URLs — placeholders are sed-replaced by GitHub Actions */
window.STREAM_URLS = {
  // Existing
  chapter_assistant: '__URL_CHAPTER_ASSISTANT__',
  experiment_guide:  '__URL_EXPERIMENT_GUIDE__',
  science_quiz:      '__URL_SCIENCE_QUIZ__',
  science_tutor:     '__URL_SCIENCE_TUTOR__',
  // Lab Tools (new)
  safety_assistant:    '__URL_SAFETY_ASSISTANT__',
  image_generator:     '__URL_IMAGE_GENERATOR__',
  what_happens_if:     '__URL_WHAT_HAPPENS_IF__',
  // Smart Flashcards (new)
  flashcard_generator: '__URL_FLASHCARD_GENERATOR__',
};

// Optional shared secret. The deploy workflow replaces __API_KEY__ with the
// value of the `API_KEY` GitHub Actions secret. Leave the placeholder as-is
// (or set the secret to an empty string) to disable the X-Api-Key check.
// NOTE: this is a *defense-in-depth* layer — the key is visible in the
// browser. Real abuse protection requires WAF/Cognito/SigV4 in front.
window.API_KEY = '__API_KEY__';
