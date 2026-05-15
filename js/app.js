/**
 * app.js - Main controller: wires AudioProcessor ↔ PianoRenderer ↔ UI.
 */

(function () {
  // --- DOM references ---
  const btnRecord = document.getElementById('btn-record');
  const btnPause  = document.getElementById('btn-pause');
  const btnStop   = document.getElementById('btn-stop');
  const statusEl  = document.getElementById('status');
  const wrapperEl = document.getElementById('piano-roll-wrapper');
  const keysEl    = document.getElementById('piano-keys');
  const canvasEl  = document.getElementById('pitch-canvas');
  const labelsEl  = document.getElementById('labels-row');
  const scrollbackEl = document.getElementById('scrollback-control');
  const sliderEl  = document.getElementById('scrollback-slider');
  const btnLatest = document.getElementById('btn-scroll-latest');

  // --- State ---
  const State = { IDLE: 'idle', RECORDING: 'recording', PAUSED: 'paused', STOPPED: 'stopped' };
  let state = State.IDLE;

  // --- Modules ---
  const renderer = PianoRenderer.create({
    keysEl, canvasEl, labelsEl, wrapperEl, scrollbackEl, sliderEl,
  });

  const processor = AudioProcessor.create({
    onPitch: function (frequency, dbLevel) {
      renderer.addDataPoint(frequency, dbLevel);
    },
    onRootDetected: function (rootFreq) {
      renderer.setRootFrequency(rootFreq);
      statusEl.textContent = 'Root: ' + Math.round(rootFreq) + ' Hz \u2014 Recording...';
      statusEl.className = 'recording';
    },
    onStatus: function (msg) {
      statusEl.textContent = msg;
    },
  });

  // --- UI helpers ---
  function setButtons(recording, paused, stopped) {
    btnRecord.disabled = recording;
    btnPause.disabled = !recording;
    btnStop.disabled = !recording && !paused;
  }

  function enterState(newState) {
    state = newState;
    switch (state) {
      case State.IDLE:
        setButtons(false, false, true);
        renderer.setAutoScroll(false);
        renderer.showScrollbackControls(false);
        statusEl.className = '';
        break;
      case State.RECORDING:
        setButtons(true, false, false);
        renderer.setAutoScroll(true);
        renderer.showScrollbackControls(false);
        renderer.scrollToLatest();
        statusEl.className = 'recording';
        break;
      case State.PAUSED:
        setButtons(false, false, false);
        renderer.setAutoScroll(false);
        renderer.showScrollbackControls(true);
        renderer.updateSlider();
        statusEl.className = '';
        break;
      case State.STOPPED:
        setButtons(false, false, true);
        renderer.setAutoScroll(false);
        renderer.showScrollbackControls(true);
        renderer.updateSlider();
        statusEl.className = '';
        break;
    }
  }

  // --- Button handlers ---
  btnRecord.addEventListener('click', async () => {
    if (state === State.PAUSED) {
      // Resume: keep existing data and root, start recording again
      enterState(State.RECORDING);
      await processor.start(); // synchronous in resume path, but keep await for safety
    } else {
      // Fresh start: clear display, then request mic
      renderer.clear();
      try {
        await processor.start();
        enterState(State.RECORDING);
      } catch (err) {
        // Permission denied or other error – stay idle
        enterState(State.IDLE);
      }
    }
  });

  btnPause.addEventListener('click', () => {
    processor.pause();
    enterState(State.PAUSED);
  });

  btnStop.addEventListener('click', () => {
    processor.stop();
    // Keep display for review, but root is cleared
    // Resetting labels since root is gone
    const cells = labelsEl.querySelectorAll('.label-cell');
    cells.forEach(cell => {
      const freqSpan = cell.querySelector('.label-freq');
      if (freqSpan) freqSpan.textContent = '\u2014';
    });
    enterState(State.STOPPED);
  });

  // --- Scrollback controls ---
  sliderEl.addEventListener('input', () => {
    renderer.scrollToSlider();
  });

  btnLatest.addEventListener('click', () => {
    renderer.scrollToLatest();
  });

  // --- Initialization ---
  function init() {
    // Defer layout-dependent setup until after first paint
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        renderer.buildPianoKeys();
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
