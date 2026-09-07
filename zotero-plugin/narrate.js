/**
 * Narrate for Zotero — narrate.js
 *
 * Loaded by bootstrap.js via Services.scriptloader.loadSubScript(), into the
 * same privileged sandbox bootstrap.js runs in (so `Zotero` etc. are already
 * global here too — see bootstrap.js for how that scope is constructed).
 *
 * This file's only job for v1: when Zotero's PDF/EPUB/snapshot reader shows
 * its text-selection popup, add a "Narrate" control to it that reads the
 * selected text aloud with the Web Speech API (window.speechSynthesis),
 * which is available because the reader itself is a regular HTML document
 * running with full Web API access inside Zotero's own sandbox — no OS
 * Accessibility/Screen-Recording permission involved.
 *
 * Reader event API used here (Zotero.Reader.registerEventListener /
 * unregisterEventListener, and the 'renderTextSelectionPopup' event shape:
 * { reader, doc, params, append }, with the selected text at
 * params.annotation.text) is verified directly against Zotero's own source,
 * not guessed:
 * https://github.com/zotero/zotero/blob/main/chrome/content/zotero/xpcom/reader.js
 * (see the registerEventListener JSDoc block and its worked example, which
 * itself reads `params.annotation.text`).
 */

var Narrate = (function () {
	const RATES = [0.75, 1, 1.25, 1.5, 2];
	const DEFAULT_RATE = 1;

	let pluginID = null;
	let currentRate = DEFAULT_RATE;

	function log(msg) {
		Zotero.debug('Narrate: ' + msg);
	}

	/**
	 * Handler for Zotero.Reader's 'renderTextSelectionPopup' event.
	 * Fires whenever the little popup that appears over a text selection in
	 * the reader is (re)rendered.
	 */
	function renderTextSelectionPopup(event) {
		try {
			const { doc, params, append } = event;
			const text = params && params.annotation && params.annotation.text;
			if (!text || !text.trim()) {
				return;
			}

			const win = doc.defaultView;
			const synth = win && win.speechSynthesis;
			if (!synth || typeof win.SpeechSynthesisUtterance !== 'function') {
				// speechSynthesis not available in this document for some
				// reason — fail quietly rather than showing a broken button.
				return;
			}

			const container = doc.createElement('div');
			container.className = 'narrate-selection-popup';
			container.style.display = 'flex';
			container.style.alignItems = 'center';
			container.style.gap = '6px';
			container.style.padding = '4px 6px';
			container.style.borderTop = '1px solid var(--material-border, #ddd)';

			const playButton = doc.createElement('button');
			playButton.type = 'button';
			playButton.textContent = '🔊 Narrate';
			playButton.title = 'Read the selected text aloud';

			const stopButton = doc.createElement('button');
			stopButton.type = 'button';
			stopButton.textContent = '⏹';
			stopButton.title = 'Stop';
			stopButton.disabled = true;
			stopButton.style.display = 'none';

			const rateSelect = doc.createElement('select');
			rateSelect.title = 'Playback speed';
			RATES.forEach((rate) => {
				const option = doc.createElement('option');
				option.value = String(rate);
				option.textContent = rate + '×';
				if (rate === currentRate) {
					option.selected = true;
				}
				rateSelect.appendChild(option);
			});

			function setSpeakingState(isSpeaking) {
				playButton.style.display = isSpeaking ? 'none' : '';
				stopButton.style.display = isSpeaking ? '' : 'none';
				stopButton.disabled = !isSpeaking;
			}

			function speak() {
				// Only one utterance at a time — stop anything already
				// playing (in this window) before starting a new one.
				synth.cancel();

				const utterance = new win.SpeechSynthesisUtterance(text);
				utterance.rate = currentRate;
				utterance.onstart = () => setSpeakingState(true);
				utterance.onend = () => setSpeakingState(false);
				utterance.onerror = (e) => {
					// 'interrupted'/'canceled' fire from our own synth.cancel()
					// calls (e.g. switching rate) — not real errors.
					if (e && e.error !== 'interrupted' && e.error !== 'canceled') {
						log('speech error: ' + (e && e.error));
					}
					setSpeakingState(false);
				};
				synth.speak(utterance);
			}

			function stop() {
				synth.cancel();
				setSpeakingState(false);
			}

			playButton.addEventListener('click', speak);
			stopButton.addEventListener('click', stop);
			rateSelect.addEventListener('change', () => {
				currentRate = parseFloat(rateSelect.value) || DEFAULT_RATE;
				// If we're already mid-utterance, restart at the new rate —
				// the Web Speech API has no way to change the rate of an
				// utterance already in progress.
				if (synth.speaking) {
					speak();
				}
			});

			container.appendChild(playButton);
			container.appendChild(stopButton);
			container.appendChild(rateSelect);
			append(container);
		}
		catch (e) {
			log('renderTextSelectionPopup handler failed: ' + e);
		}
	}

	return {
		init({ id }) {
			pluginID = id;
		},

		addToReader() {
			Zotero.Reader.registerEventListener(
				'renderTextSelectionPopup',
				renderTextSelectionPopup,
				pluginID
			);
			log('registered renderTextSelectionPopup handler');
		},

		removeFromReader() {
			Zotero.Reader.unregisterEventListener(
				'renderTextSelectionPopup',
				renderTextSelectionPopup
			);
			log('unregistered renderTextSelectionPopup handler');
		},
	};
})();
