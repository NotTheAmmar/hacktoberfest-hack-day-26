/**
 * extractor.js — Google Forms DOM extractor
 *
 * Injected into docs.google.com/forms/* pages.
 * Exposes window.__LWP_extractForm() which parses the form DOM
 * into a structured JSON schema.
 *
 * Google Forms uses data-params and aria attributes extensively.
 * We target the rendered HTML rather than any internal JS objects.
 */

(function () {
  'use strict';

  /**
   * Map of detected Google Forms field type identifiers to our schema types.
   * These are derived from the role/type attributes on rendered form elements.
   */
  const FIELD_TYPE_MAP = {
    text:     'short_text',
    textarea: 'paragraph',
    radio:    'radio',
    checkbox: 'checkbox',
    select:   'dropdown',
    listbox:  'dropdown',
    combobox: 'dropdown',
  };

  /**
   * Extract a single question block from its container element.
   * @param {Element} container - The question container div
   * @param {number} index - Question index (0-based)
   * @returns {Object|null} Question schema object or null if unparseable
   */
  function extractQuestion(container, index) {
    // ── Label ──
    // Google Forms renders the question text in a span/div with role="heading"
    // or in elements with data-params. We try multiple selectors.
    const labelEl =
      container.querySelector('[role="heading"]') ||
      container.querySelector('.freebirdFormviewerComponentsQuestionBaseTitle') ||
      container.querySelector('[data-item-id]');

    const label = labelEl?.textContent?.trim() || `Question ${index + 1}`;

    // ── Description / help text ──
    const descEl =
      container.querySelector('.freebirdFormviewerComponentsQuestionBaseDescription') ||
      container.querySelector('[role="note"]');
    const description = descEl?.textContent?.trim() || null;

    // ── Required ──
    // Google Forms adds an asterisk span or aria-required on required fields
    const required =
      container.querySelector('[aria-required="true"]') !== null ||
      container.querySelector('.freebirdFormviewerComponentsQuestionBaseRequiredAsterisk') !== null ||
      container.textContent.includes('*');

    // ── Determine field type and options ──
    let type = 'short_text';
    let options = null;

    // Check for radio group
    const radios = container.querySelectorAll('[role="radio"]');
    if (radios.length > 0) {
      type = 'radio';
      options = Array.from(radios)
        .map(r => r.getAttribute('aria-label') || r.textContent.trim())
        .filter(Boolean);
    }

    // Check for checkboxes
    const checkboxes = container.querySelectorAll('[role="checkbox"]');
    if (checkboxes.length > 0) {
      type = 'checkbox';
      options = Array.from(checkboxes)
        .map(c => c.getAttribute('aria-label') || c.textContent.trim())
        .filter(Boolean);
    }

    // Check for dropdown / listbox / combobox
    const listbox = container.querySelector('[role="listbox"], [role="combobox"], select');
    if (listbox) {
      type = 'dropdown';
      // For Google Forms' custom dropdown, options are in [role="option"] siblings
      // that appear in the document after the combobox is opened.
      // We use data-value or aria-label attributes.
      const optionEls = document.querySelectorAll('[role="option"]');
      if (optionEls.length > 0) {
        options = Array.from(optionEls)
          .map(o => o.getAttribute('data-value') || o.textContent.trim())
          .filter(Boolean);
      }
      // Fallback: native select
      const nativeSelect = container.querySelector('select');
      if (nativeSelect && !options?.length) {
        options = Array.from(nativeSelect.options)
          .filter(o => o.value)
          .map(o => o.text.trim());
      }
    }

    // Check for textarea (paragraph)
    const textarea = container.querySelector('textarea');
    if (textarea) type = 'paragraph';

    // Check for date input
    const dateInput = container.querySelector('input[type="date"], [aria-label*="date" i], [aria-label*="Date" i]');
    if (dateInput) type = 'date';

    // Check for time input
    const timeInput = container.querySelector('input[type="time"], [aria-label*="time" i], [aria-label*="Time" i]');
    if (timeInput) type = 'time';

    // Default: short text input
    const textInput = container.querySelector('input[type="text"], input:not([type])');
    // (type already defaulted to short_text above)

    // ── Build DOM selector for later autofill ──
    // We attach a unique data attribute so filler.js can target this exact question
    const questionId = `q${index}`;
    container.setAttribute('data-lwp-id', questionId);

    return {
      id: questionId,
      index,
      label,
      description,
      type,
      required,
      options,
      validation: buildValidation(type, container),
    };
  }

  /**
   * Build a validation rules object based on field type and DOM attributes.
   */
  function buildValidation(type, container) {
    const rules = {};

    if (type === 'short_text' || type === 'paragraph') {
      const input = container.querySelector('input, textarea');
      if (input?.maxLength > 0) rules.max_length = input.maxLength;
      // Email heuristic
      if (container.querySelector('[type="email"]') ||
          container.textContent.match(/email/i)) {
        rules.format = 'email';
      }
      // Phone heuristic
      if (container.textContent.match(/phone|mobile|contact/i)) {
        rules.format = 'phone';
      }
    }

    return Object.keys(rules).length ? rules : null;
  }

  /**
   * Main extraction function exposed on window.
   * @returns {Object} Full form schema
   */
  window.__LWP_extractForm = function () {
    // ── Form title and description ──
    const titleEl =
      document.querySelector('.freebirdFormviewerViewHeaderTitle') ||
      document.querySelector('[role="heading"][aria-level="1"]') ||
      document.querySelector('title');
    const form_title = titleEl?.textContent?.trim() ||
      document.title.replace('- Google Forms', '').trim() ||
      'Untitled Form';

    const descEl =
      document.querySelector('.freebirdFormviewerViewHeaderDescription') ||
      document.querySelector('.freebirdFormviewerComponentsBlocksFormBodyListItem');
    const form_description = descEl?.textContent?.trim() || null;

    // ── Question containers ──
    // Google Forms wraps each question in a div. We try several known class names
    // plus a fallback using role="listitem".
    const containers = [
      ...document.querySelectorAll('.freebirdFormviewerViewItemsItemItem'),
      ...document.querySelectorAll('[role="listitem"]'),
    ];

    // Deduplicate (in case both selectors match the same element)
    const unique = [...new Set(containers)];

    const questions = unique
      .map((el, i) => extractQuestion(el, i))
      .filter(Boolean);

    const schema = {
      form_title,
      form_description,
      form_url: window.location.href,
      extracted_at: new Date().toISOString(),
      questions,
    };

    console.log('[LWP Extractor] Extracted schema:', schema);
    return schema;
  };

  console.log('[LWP Extractor] Ready. Call window.__LWP_extractForm() to extract.');
})();
