/**
 * filler.js — Google Forms autofill content script
 *
 * Injected into docs.google.com/forms/* pages.
 * Supports:
 *   1. Direct DOM Autofill via entry.XXXX IDs:
 *      Inputs, textareas, radios, dropdowns, checkboxes, date, time, linear scale.
 *   2. Pre-filled URL Generator:
 *      Constructs viewform?entry.XXXX=val&... URLs for redirection prefill.
 *   3. Native change/input event dispatching for Google Forms form state.
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

    // React/Angular execCommand simulation
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
   * Fills an individual entry using its Google Form entry.XXXX ID.
   */
  function fillByEntryId(entryId, value) {
    const cleanId = String(entryId).trim();
    const strVal = String(value).trim();
    if (!strVal) return false;

    // 1. Direct match: <input name="entry.123456789"> or <textarea name="entry.123456789">
    const directInput = document.querySelector(`input[name="${cleanId}"], textarea[name="${cleanId}"]`);
    if (directInput) {
      if (directInput.type === 'radio') {
        const matchingRadio = document.querySelector(`input[name="${cleanId}"][value="${strVal}"]`) ||
                              directInput.closest('[role="listitem"]')?.querySelector(`[role="radio"][aria-label*="${strVal}" i]`);
        if (matchingRadio) {
          matchingRadio.click();
          return true;
        }
      } else if (directInput.type === 'checkbox') {
        const values = strVal.split(',').map(s => s.trim().toLowerCase());
        const checkboxes = document.querySelectorAll(`input[name="${cleanId}"]`);
        let clicked = false;
        checkboxes.forEach(cb => {
          if (values.includes(cb.value.toLowerCase())) {
            if (!cb.checked) cb.click();
            clicked = true;
          }
        });
        if (clicked) return true;
      }

      return setInputValue(directInput, strVal);
    }

    // 2. Container search by entry number: data-params="[...123456789...]"
    const numId = cleanId.replace(/\D/g, '');
    let container = null;
    if (numId) {
      container = document.querySelector(`[data-params*="${numId}"]`) ||
                  document.querySelector(`[data-item-id="${numId}"]`);
    }

    if (container) {
      // Direct text or textarea inside container
      const input = container.querySelector('input:not([type="hidden"]), textarea');
      if (input && input.type !== 'radio' && input.type !== 'checkbox') {
        return setInputValue(input, strVal);
      }

      // Radio button group
      const radios = container.querySelectorAll('[role="radio"]');
      if (radios.length > 0) {
        for (const r of radios) {
          const label = (r.getAttribute('aria-label') || r.getAttribute('data-value') || r.textContent || '').trim().toLowerCase();
          if (label === strVal.toLowerCase() || label.includes(strVal.toLowerCase())) {
            r.click();
            return true;
          }
        }
      }

      // Checkbox group (supports comma-separated multiple options)
      const checkboxes = container.querySelectorAll('[role="checkbox"]');
      if (checkboxes.length > 0) {
        const targetValues = strVal.split(',').map(s => s.trim().toLowerCase());
        let count = 0;
        for (const cb of checkboxes) {
          const label = (cb.getAttribute('aria-label') || cb.getAttribute('data-value') || cb.textContent || '').trim().toLowerCase();
          const shouldCheck = targetValues.some(t => label === t || label.includes(t));
          if (shouldCheck) {
            const isChecked = cb.getAttribute('aria-checked') === 'true';
            if (!isChecked) cb.click();
            count++;
          }
        }
        if (count > 0) return true;
      }

      // Dropdown / Combobox
      const select = container.querySelector('select');
      if (select) {
        for (const opt of select.options) {
          if (opt.text.trim().toLowerCase() === strVal.toLowerCase()) {
            select.value = opt.value;
            triggerEvents(select);
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * Option A: Pre-filled URL Generator
   * Constructs viewform?entry.ID=value&...
   */
  function getPrefilledUrl(baseUrl, mappedEntries) {
    try {
      const cleanUrl = new URL((baseUrl || window.location.href).replace('/edit', '/viewform'));
      Object.entries(mappedEntries || {}).forEach(([entryId, value]) => {
        if (value) cleanUrl.searchParams.set(entryId, String(value));
      });
      return cleanUrl.toString();
    } catch (e) {
      console.error('[LWP Filler] Failed to generate prefilled URL:', e);
      return null;
    }
  }

  /**
   * Option B: Direct DOM Autofill
   */
  function fillDomDirectly(mappedEntries) {
    const result = { filled: 0, total: 0, errors: [] };
    const entries = Object.entries(mappedEntries || {});
    result.total = entries.length;

    for (const [entryId, value] of entries) {
      if (!value) continue;
      try {
        const ok = fillByEntryId(entryId, value);
        if (ok) {
          result.filled++;
        } else {
          result.errors.push(`Could not locate field for ${entryId}`);
        }
      } catch (err) {
        result.errors.push(`Error filling ${entryId}: ${err.message}`);
      }
    }
    return result;
  }

  /**
   * Global entrypoint exposed on window.
   */
  window.__LWP_fillForm = async function (payload) {
    const mappedEntries = payload?.mapped_entries || 
                          (payload?.answers ? null : payload) || 
                          {};

    // Handle Option B (Entry ID mapped)
    if (mappedEntries && Object.keys(mappedEntries).length > 0) {
      const result = fillDomDirectly(mappedEntries);
      console.log('[LWP Filler] Direct DOM Autofill result:', result);
      return result;
    }

    // Handle legacy question ID structure
    const answers = payload?.answers ?? {};
    let filled = 0;
    const entries = Object.entries(answers);
    for (const [qId, ansObj] of entries) {
      const val = ansObj?.value ?? ansObj;
      if (!val) continue;
      const el = document.querySelector(`[data-lwp-id="${qId}"]`);
      if (el) {
        const inp = el.querySelector('input:not([type="hidden"]), textarea');
        if (inp && setInputValue(inp, val)) filled++;
      }
      await new Promise(r => setTimeout(r, 60));
    }
    return { filled, total: entries.length, errors: [] };
  };

  window.__LWP_getPrefilledUrl = getPrefilledUrl;

  console.log('[LWP Filler] Ready. Direct DOM filling and prefill URL available.');
})();
