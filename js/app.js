/**
 * app.js - Main controller: wires AudioProcessor ↔ PianoRenderer ↔ UI.
 */

(function () {
  // --- DOM references ---
  const btnRecord = document.getElementById('btn-record');
  const btnPause  = document.getElementById('btn-pause');
  const btnReset  = document.getElementById('btn-reset');
  const statusEl  = document.getElementById('status');
  const wrapperEl = document.getElementById('piano-roll-wrapper');
  const keysEl    = document.getElementById('piano-keys');
  const canvasEl  = document.getElementById('pitch-canvas');
  const scrollbackEl = document.getElementById('scrollback-control');
  const sliderEl  = document.getElementById('scrollback-slider');
  const btnLatest = document.getElementById('btn-scroll-latest');

  // --- State ---
  const State = { IDLE: 'idle', RECORDING: 'recording', PAUSED: 'paused' };
  let state = State.IDLE;

  // --- Modules ---
  const renderer = PianoRenderer.create({
    keysEl, canvasEl, wrapperEl, scrollbackEl, sliderEl,
  });

  const processor = AudioProcessor.create({
    onPitch: function (frequency) {
      renderer.addDataPoint(frequency);
    },
    onStatus: function (msg) {
      statusEl.textContent = msg;
    },
  });

  // --- UI helpers ---
  function setButtons(recording, paused) {
    btnRecord.disabled = recording;
    btnPause.disabled = !recording;
    btnReset.disabled = !paused;
  }

  function enterState(newState) {
    state = newState;
    switch (state) {
      case State.IDLE:
        setButtons(false, false);
        renderer.setAutoScroll(false);
        renderer.showScrollbackControls(false);
        statusEl.className = '';
        break;
      case State.RECORDING:
        setButtons(true, false);
        renderer.setAutoScroll(true);
        renderer.showScrollbackControls(false);
        renderer.scrollToLatest();
        statusEl.className = 'recording';
        break;
      case State.PAUSED:
        setButtons(false, true);
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
      // Resume: keep existing data, start recording again
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

  btnReset.addEventListener('click', () => {
    processor.stop();
    renderer.clear();
    enterState(State.IDLE);
  });

  // --- Scrollback controls ---
  sliderEl.addEventListener('input', () => {
    renderer.scrollToSlider();
  });

  btnLatest.addEventListener('click', () => {
    renderer.scrollToLatest();
  });
})();
