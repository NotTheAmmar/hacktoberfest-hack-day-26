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
    if (!element) return;
    ['focus', 'keydown', 'keypress', 'input', 'keyup', 'change', 'blur'].forEach(evtType => {
      try {
        element.dispatchEvent(new Event(evtType, { bubbles: true, composed: true }));
      } catch (e) {}
    });
  }

  function setInputValue(input, value) {
    if (!input) return false;
    const strVal = String(value ?? '');
    input.focus();

    // 1. Native prototype setter to bypass framework state traps
    const proto = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (nativeSetter) {
      nativeSetter.call(input, strVal);
    } else {
      input.value = strVal;
    }

    // 2. React / Google Closure execCommand simulation
    if (document.execCommand) {
      try {
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, strVal);
      } catch (e) {}
    }

    // Ensure value is set
    input.value = strVal;

    // 3. Always dispatch standard input & change events
    triggerEvents(input);
    return true;
  }

  /**
   * Helper to fill an element container (handles text, radio, checkbox, dropdown)
   */
  function fillContainer(container, strVal) {
    if (!container || !strVal) return false;

    // A. Radio buttons
    const radios = container.querySelectorAll('[role="radio"]');
    if (radios.length > 0) {
      const lower = strVal.toLowerCase();
      for (const r of radios) {
        const label = (r.getAttribute('aria-label') || r.getAttribute('data-value') || r.textContent || '').trim().toLowerCase();
        if (label === lower || label.includes(lower) || lower.includes(label)) {
          r.focus();
          r.click();
          try {
            r.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            r.dispatchEvent(new Event('change', { bubbles: true }));
          } catch (e) {}
          return true;
        }
      }
    }

    // B. Checkboxes (comma-separated or single)
    const checkboxes = container.querySelectorAll('[role="checkbox"]');
    if (checkboxes.length > 0) {
      const targetValues = strVal.split(',').map(s => s.trim().toLowerCase());
      let matched = false;
      for (const cb of checkboxes) {
        const label = (cb.getAttribute('aria-label') || cb.getAttribute('data-value') || cb.textContent || '').trim().toLowerCase();
        const shouldCheck = targetValues.some(t => label === t || label.includes(t) || t.includes(label));
        if (shouldCheck) {
          const isChecked = cb.getAttribute('aria-checked') === 'true';
          if (!isChecked) {
            cb.click();
            try {
              cb.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
              cb.dispatchEvent(new Event('change', { bubbles: true }));
            } catch (e) {}
          }
          matched = true;
        }
      }
      if (matched) return true;
    }

    // C. Dropdown / Select
    const select = container.querySelector('select');
    if (select) {
      const lower = strVal.toLowerCase();
      for (const opt of select.options) {
        if (opt.text.trim().toLowerCase() === lower || opt.text.trim().toLowerCase().includes(lower)) {
          select.value = opt.value;
          triggerEvents(select);
          return true;
        }
      }
    }

    // D. Direct input or textarea inside container
    const input = container.querySelector('input:not([type="hidden"]), textarea');
    if (input && input.type !== 'radio' && input.type !== 'checkbox') {
      return setInputValue(input, strVal);
    }

    return false;
  }

  /**
   * Fills an individual entry using its Google Form entry.XXXX ID or field label.
   */
  function fillByEntryId(entryId, value) {
    const cleanId = String(entryId || '').trim();
    const strVal = String(value || '').trim();
    if (!cleanId || !strVal) return false;

    // 1. Direct match by name attribute: <input name="entry.123456789">
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
      if (container && fillContainer(container, strVal)) {
        return true;
      }
    }

    // 3. Fallback: Search question container by label / heading text
    const targetLabel = cleanId.toLowerCase().replace(/^entry\.\d+\s*[-:]?\s*/, '').trim();
    if (targetLabel) {
      const items = document.querySelectorAll('[role="listitem"], .Qr7Oae, .freebirdFormviewerComponentsQuestionBaseRoot');
      for (const item of items) {
        const heading = item.querySelector('[role="heading"], .M7eMe, .freebirdFormviewerComponentsQuestionBaseTitle');
        const headingText = (heading?.textContent || '').toLowerCase().trim();
        if (headingText && (headingText === targetLabel || headingText.includes(targetLabel) || targetLabel.includes(headingText))) {
          if (fillContainer(item, strVal)) {
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
