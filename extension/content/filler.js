/**
 * filler.js — Google Forms autofill content script
 *
 * Injected into docs.google.com/forms/* pages.
 * Supports:
 *   1. Direct Entry IDs mapping:
 *      document.querySelector(`[name="${entryId}"]`) or [data-params] matching "entry.XXXX"
 *   2. Question ID / Index mapping fallback
 *
 * Dispatches native input/change/blur events so Google Forms registers the inputs.
 */

(function () {
  'use strict';

  function triggerEvents(element) {
    ['focus', 'input', 'change', 'blur'].forEach(evtType => {
      element.dispatchEvent(new Event(evtType, { bubbles: true }));
    });
  }

  function setInputValue(input, value) {
    if (!input) return false;
    input.focus();
    input.value = '';
    
    // React / Angular synthetic event handling
    if (document.execCommand) {
      try {
        document.execCommand('insertText', false, String(value));
      } catch (e) {}
    }

    if (input.value !== String(value)) {
      const proto = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (nativeSetter) {
        nativeSetter.call(input, String(value));
      } else {
        input.value = String(value);
      }
      triggerEvents(input);
    }
    return true;
  }

  /**
   * Fills an entry using its Google Form entry.XXXX ID.
   * Finds inputs with name="entry.XXXX", data-item-id, aria-labelledby, etc.
   */
  function fillByEntryId(entryId, value) {
    const cleanId = String(entryId).trim();
    const strVal = String(value).trim();

    // 1. Direct name match: <input name="entry.123456789">
    let target = document.querySelector(`[name="${cleanId}"]`);
    if (target) {
      if (target.type === 'radio' || target.type === 'checkbox') {
        // Radio / checkbox with matching value or aria-label
        const matchingOpt = document.querySelector(`[name="${cleanId}"][value="${strVal}"]`) ||
                            target.closest('[role="listitem"]')?.querySelector(`[aria-label*="${strVal}" i]`);
        if (matchingOpt) {
          matchingOpt.click();
          return true;
        }
      }
      return setInputValue(target, strVal);
    }

    // 2. Search inside container matching entryId or numbers
    const numId = cleanId.replace(/\D/g, '');
    let container = null;
    if (numId) {
      container = document.querySelector(`[data-params*="${numId}"]`) ||
                  document.querySelector(`[data-item-id="${numId}"]`);
    }

    if (container) {
      const input = container.querySelector('input:not([type="hidden"]), textarea');
      if (input) return setInputValue(input, strVal);

      // Check for radio
      const radio = container.querySelector(`[role="radio"][aria-label*="${strVal}" i]`) ||
                    container.querySelector(`[role="radio"]`);
      if (radio) {
        radio.click();
        return true;
      }

      // Check for checkbox
      const checkbox = container.querySelector(`[role="checkbox"][aria-label*="${strVal}" i]`);
      if (checkbox) {
        checkbox.click();
        return true;
      }
    }

    return false;
  }

  /**
   * Main fill function exposed on window.
   * Accepts:
   *   - mapped_entries object: { "entry.123": "Value", ... }
   *   - OR standard payload: { mapped_entries: { ... } }
   *   - OR schema format: { answers: { q0: { value, ... } } }
   */
  window.__LWP_fillForm = async function (payload) {
    const result = { filled: 0, total: 0, errors: [] };
    const mappedEntries = payload?.mapped_entries || 
                          (payload?.answers ? null : payload) || 
                          {};

    // Mode A: Entry ID based (Kaggle Backend schema)
    if (mappedEntries && Object.keys(mappedEntries).length > 0) {
      const entries = Object.entries(mappedEntries);
      result.total = entries.length;

      for (const [entryId, value] of entries) {
        if (!value) continue;
        try {
          const success = fillByEntryId(entryId, value);
          if (success) {
            result.filled++;
          } else {
            result.errors.push(`Could not locate field for ${entryId}`);
          }
        } catch (err) {
          result.errors.push(`Error filling ${entryId}: ${err.message}`);
        }
        await new Promise(r => setTimeout(r, 80));
      }

      console.log('[LWP Filler] Entry-ID Autofill complete:', result);
      return result;
    }

    // Mode B: Question Object / ID based fallback
    const answers = payload?.answers ?? {};
    const entries = Object.entries(answers);
    result.total = entries.length;

    for (const [qId, ansObj] of entries) {
      const val = ansObj?.value ?? ansObj;
      if (!val) continue;

      let el = document.querySelector(`[data-lwp-id="${qId}"]`) ||
               document.querySelectorAll('[role="listitem"]')[ansObj?.index ?? 0];

      if (el) {
        const inp = el.querySelector('input:not([type="hidden"]), textarea');
        if (inp && setInputValue(inp, val)) {
          result.filled++;
        }
      }
      await new Promise(r => setTimeout(r, 80));
    }

    return result;
  };

  console.log('[LWP Filler] Ready. Call window.__LWP_fillForm(payload) to fill.');
})();
