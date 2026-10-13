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

  /**
   * Extracts fields matching Kaggle's /api/v1/parse-fields format:
   * [{ id: "entry.184920482", label: "Full Name", type: "short_text", options?: [...] }]
   * Used as an instant client-side fallback if Kaggle server cannot scrape the form (e.g. auth-protected or private forms).
   */
  window.__LWP_getKaggleFields = function () {
    const FIELD_MAP = {
      0: "short_text", 1: "paragraph", 2: "radio",
      3: "dropdown",   4: "checkbox",  5: "linear_scale",
      7: "grid",       9: "date",     10: "time", 13: "file_upload",
    };

    // 1. Try parsing FB_PUBLIC_LOAD_DATA_ directly from scripts or window
    try {
      let rawData = null;
      if (typeof window.FB_PUBLIC_LOAD_DATA_ !== 'undefined' && Array.isArray(window.FB_PUBLIC_LOAD_DATA_)) {
        rawData = window.FB_PUBLIC_LOAD_DATA_;
      } else {
        const scripts = document.querySelectorAll('script');
        for (const s of scripts) {
          const txt = s.textContent || '';
          if (txt.includes('FB_PUBLIC_LOAD_DATA_')) {
            const m = txt.match(/FB_PUBLIC_LOAD_DATA_\s*=\s*(\[.*?\]);\s*(?:<\/script>|\n|var|$)/s) ||
                      txt.match(/var\s+FB_PUBLIC_LOAD_DATA_\s*=\s*(\[.*?\]);/s);
            if (m) {
              rawData = JSON.parse(m[1]);
              break;
            }
          }
        }
      }

      if (rawData && rawData[1] && Array.isArray(rawData[1][1])) {
        const questions = rawData[1][1];
        const fields = [];
        for (const q of questions) {
          if (q && q.length > 4 && q[4] && q[4][0]) {
            const label = q[1];
            const typeCode = q[3];
            const fieldType = FIELD_MAP[typeCode] || "short_text";
            const entryId = `entry.${q[4][0][0]}`;
            const item = { id: entryId, label, type: fieldType };

            if ([2, 3, 4].includes(typeCode) && q[4][0].length > 1 && q[4][0][1]) {
              item.options = q[4][0][1].filter(opt => opt && opt[0]).map(opt => opt[0]);
            }
            fields.push(item);
          }
        }
        if (fields.length > 0) {
          console.log('[LWP Extractor] Client extracted fields from FB_PUBLIC_LOAD_DATA_:', fields);
          return fields;
        }
      }
    } catch (err) {
      console.warn('[LWP Extractor] Failed extracting from script metadata, falling back to DOM:', err);
    }

    // 2. DOM inspection fallback
    const fields = [];
    const seenIds = new Set();

    // Check containers with data-params
    const containers = document.querySelectorAll('[data-params*="%.@.["]');
    containers.forEach((c) => {
      const params = c.getAttribute('data-params');
      const idMatch = params ? params.match(/\[(\d{6,12})/) : null;
      if (idMatch && !seenIds.has(idMatch[1])) {
        seenIds.add(idMatch[1]);
        const entryId = `entry.${idMatch[1]}`;
        const labelEl = c.querySelector('[role="heading"]') ||
                        c.querySelector('.freebirdFormviewerComponentsQuestionBaseTitle') ||
                        c.querySelector('[data-item-id]');
        const label = (labelEl?.textContent || 'Question').replace(/\s*\*$/, '').trim();

        let type = 'short_text';
        if (c.querySelector('textarea')) type = 'paragraph';
        else if (c.querySelector('[role="radio"]')) type = 'radio';
        else if (c.querySelector('[role="checkbox"]')) type = 'checkbox';
        else if (c.querySelector('select, [role="listbox"]')) type = 'dropdown';

        const item = { id: entryId, label, type };
        if (type === 'radio' || type === 'checkbox') {
          const opts = Array.from(c.querySelectorAll('[role="radio"], [role="checkbox"]'))
            .map(el => el.getAttribute('aria-label') || el.textContent.trim())
            .filter(Boolean);
          if (opts.length > 0) item.options = opts;
        }
        fields.push(item);
      }
    });

    // Check direct input[name^="entry."]
    document.querySelectorAll('input[name^="entry."], textarea[name^="entry."]').forEach((inp) => {
      const name = inp.getAttribute('name');
      if (name && !seenIds.has(name)) {
        seenIds.add(name);
        const container = inp.closest('[role="listitem"]') || inp.parentElement;
        const labelEl = container?.querySelector('[role="heading"]') || container?.querySelector('label');
        const label = (labelEl?.textContent || name).replace(/\s*\*$/, '').trim();
        fields.push({ id: name, label, type: inp.tagName === 'TEXTAREA' ? 'paragraph' : 'short_text' });
      }
    });

    function attachInterviewPrompt(item) {
      const label = item.label || 'this question';
      if (item.options && item.options.length > 0) {
        item.interview_prompt = `Which ${label.toLowerCase()} are you with: ${item.options.slice(0, 4).join(', ')}${item.options.length > 4 ? ', or others' : ''}?`;
      } else if (item.type === 'date') {
        item.interview_prompt = `What is the date for ${label.toLowerCase()}?`;
      } else if (item.type === 'time') {
        item.interview_prompt = `What time for ${label.toLowerCase()}?`;
      } else {
        item.interview_prompt = label.endsWith('?') ? label : `What is your ${label.toLowerCase()}?`;
      }
      return item;
    }

    const finalFields = fields.map(attachInterviewPrompt);
    console.log('[LWP Extractor] Client extracted fields from DOM:', finalFields);
    return finalFields;
  };

  console.log('[LWP Extractor] Ready. Call window.__LWP_extractForm() or window.__LWP_getKaggleFields().');
})();
