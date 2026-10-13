/**
 * filler.js — Google Forms autofill content script
 *
 * Injected into docs.google.com/forms/* pages.
 * Exposes window.__LWP_fillForm(autofillData) which maps backend answers
 * to the correct DOM fields and programmatically fills them.
 *
 * Important: Google Forms detects DOM changes via React/Angular event handlers.
 * We must dispatch native input/change events after setting values so the form
 * registers the new values properly.
 */

(function () {
  'use strict';

  /**
   * Dispatch the events Google Forms needs to register a changed value.
   */
  function triggerEvents(element) {
    ['focus', 'input', 'change', 'blur'].forEach(evtType => {
      element.dispatchEvent(new Event(evtType, { bubbles: true }));
    });
  }

  /**
   * Fill a short_text or paragraph field.
   */
  function fillText(container, value) {
    const input = container.querySelector('input[type="text"], input:not([type]), textarea');
    if (!input) return false;
    input.focus();
    // Use execCommand for React-managed inputs (sets native input value)
    input.value = '';
    input.focus();
    document.execCommand?.('insertText', false, String(value));
    // Fallback: direct assignment + events
    if (input.value !== String(value)) {
      const nativeInputSetter = Object.getOwnPropertyDescriptor(
        input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
        'value'
      )?.set;
      if (nativeInputSetter) {
        nativeInputSetter.call(input, String(value));
      } else {
        input.value = String(value);
      }
      triggerEvents(input);
    }
    return true;
  }

  /**
   * Fill a radio button group.
   * value: the option label string to select.
   */
  function fillRadio(container, value) {
    const radios = container.querySelectorAll('[role="radio"]');
    for (const radio of radios) {
      const label = radio.getAttribute('aria-label') || radio.textContent.trim();
      if (label.toLowerCase() === String(value).toLowerCase()) {
        radio.click();
        return true;
      }
    }
    // Fuzzy match: starts with or contains
    for (const radio of radios) {
      const label = (radio.getAttribute('aria-label') || radio.textContent.trim()).toLowerCase();
      const target = String(value).toLowerCase();
      if (label.startsWith(target) || label.includes(target)) {
        radio.click();
        return true;
      }
    }
    console.warn('[LWP Filler] Radio option not found:', value);
    return false;
  }

  /**
   * Fill checkbox group.
   * value: string or array of strings to check.
   */
  function fillCheckbox(container, value) {
    const targets = Array.isArray(value)
      ? value.map(v => String(v).toLowerCase())
      : [String(value).toLowerCase()];

    const checkboxes = container.querySelectorAll('[role="checkbox"]');
    let filled = 0;

    for (const cb of checkboxes) {
      const label = (cb.getAttribute('aria-label') || cb.textContent.trim()).toLowerCase();
      const shouldCheck = targets.some(t => label === t || label.includes(t));

      if (shouldCheck) {
        const isChecked = cb.getAttribute('aria-checked') === 'true';
        if (!isChecked) {
          cb.click();
          filled++;
        } else {
          filled++; // already checked, counts as filled
        }
      }
    }
    return filled > 0;
  }

  /**
   * Fill a dropdown / combobox.
   * Opens the dropdown, clicks the matching option, closes it.
   */
  async function fillDropdown(container, value) {
    // Find the combobox trigger
    const trigger = container.querySelector('[role="combobox"], [role="listbox"]');
    const nativeSelect = container.querySelector('select');

    // Native select (simpler path)
    if (nativeSelect) {
      const target = String(value).toLowerCase();
      for (const option of nativeSelect.options) {
        if (option.text.trim().toLowerCase() === target) {
          nativeSelect.value = option.value;
          triggerEvents(nativeSelect);
          return true;
        }
      }
      return false;
    }

    if (!trigger) return false;

    // Open the dropdown
    trigger.click();
    await sleep(300);

    // Find and click the matching option
    const options = document.querySelectorAll('[role="option"]');
    const target = String(value).toLowerCase();

    for (const opt of options) {
      const optText = (opt.getAttribute('data-value') || opt.textContent.trim()).toLowerCase();
      if (optText === target || optText.includes(target)) {
        opt.click();
        return true;
      }
    }

    // Close dropdown if nothing matched
    trigger.click();
    console.warn('[LWP Filler] Dropdown option not found:', value);
    return false;
  }

  /**
   * Fill a date field. value should be 'YYYY-MM-DD' or a recognizable date string.
   */
  function fillDate(container, value) {
    const inputs = container.querySelectorAll('input[type="text"], input[type="number"]');
    // Google Forms date fields render as separate month/day/year inputs
    if (inputs.length >= 3) {
      const date = new Date(value);
      if (!isNaN(date)) {
        const [month, day, year] = [
          date.getMonth() + 1,
          date.getDate(),
          date.getFullYear(),
        ];
        // Order: Month, Day, Year (standard Google Forms layout)
        const nativeMonthSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        [[inputs[0], month], [inputs[1], day], [inputs[2], year]].forEach(([inp, val]) => {
          nativeMonthSetter?.call(inp, String(val));
          triggerEvents(inp);
        });
        return true;
      }
    }
    // Single input fallback
    return fillText(container, value);
  }

  /**
   * Find a question container by its data-lwp-id or by index fallback.
   */
  function findContainer(questionId, index) {
    // First try: match by data-lwp-id set during extraction
    const byId = document.querySelector(`[data-lwp-id="${questionId}"]`);
    if (byId) return byId;

    // Fallback: by index in the question list
    const all = document.querySelectorAll(
      '.freebirdFormviewerViewItemsItemItem, [role="listitem"]'
    );
    return all[index] || null;
  }

  /**
   * Sleep helper.
   */
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Main fill function exposed on window.
   * @param {Object} autofillData - { answers: { [questionId]: { value, type, index } } }
   * @returns {{ filled: number, total: number, errors: string[] }}
   */
  window.__LWP_fillForm = async function (autofillData) {
    const answers = autofillData?.answers ?? {};
    const entries = Object.entries(answers);
    const result = { filled: 0, total: entries.length, errors: [] };

    for (const [questionId, answerObj] of entries) {
      const { value, type, index } = answerObj;

      if (value === null || value === undefined || value === '') continue;

      const container = findContainer(questionId, index ?? 0);
      if (!container) {
        result.errors.push(`Container not found for ${questionId}`);
        continue;
      }

      let ok = false;
      try {
        switch (type) {
          case 'short_text':
          case 'paragraph':
            ok = fillText(container, value);
            break;
          case 'radio':
            ok = fillRadio(container, value);
            break;
          case 'checkbox':
            ok = fillCheckbox(container, value);
            break;
          case 'dropdown':
            ok = await fillDropdown(container, value);
            break;
          case 'date':
            ok = fillDate(container, value);
            break;
          default:
            ok = fillText(container, value);
        }
      } catch (err) {
        result.errors.push(`Error filling ${questionId}: ${err.message}`);
      }

      if (ok) result.filled++;
      // Small delay between fields so Google Forms can register changes
      await sleep(80);
    }

    console.log('[LWP Filler] Result:', result);
    return result;
  };

  console.log('[LWP Filler] Ready. Call window.__LWP_fillForm(data) to fill.');
})();
