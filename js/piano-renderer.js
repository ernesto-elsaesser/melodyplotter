/**
 * PianoRenderer - Builds the HTML piano roll, manages the canvas overlay,
 * renders the pitch plot, and handles scrollback.
 */

const PianoRenderer = (function () {
  // --- Tunable constants ---
  const PIXELS_PER_ROW = 4;        // vertical space per data point
  const HISTORY_SECONDS = 5;        // seconds visible in viewport (approximate)
  const PLOT_COLOR = '#ff4757';     // red pitch line
  const PLOT_LINE_WIDTH = 5;
  const PLOT_DOT_RADIUS = 3;

  const OCTAVES_BELOW = 1;
  const OCTAVES_ABOVE = 1;
  const TOTAL_OCTAVES = OCTAVES_BELOW + 1 + OCTAVES_ABOVE; // = 3
  const SEMITONES_PER_OCTAVE = 12;
  const NUM_COLUMNS = TOTAL_OCTAVES * SEMITONES_PER_OCTAVE; // = 36

  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const IS_BLACK = [false, true, false, true, false, false, true, false, true, false, true, false];

  /**
   * Snap a frequency to the closest equal-tempered note (A4 = 440 Hz).
   * Returns { frequency, noteIndex, octave, noteName } or null for invalid input.
   */
  function snapToNote(frequency) {
    if (frequency == null || frequency <= 0) return null;
    const semitoneOffset = Math.round(12 * Math.log2(frequency / 440));
    // absoluteSemitone: 0 = C0. A4 = noteIndex 9 + 4*12 = 57
    const absoluteSemitone = semitoneOffset + 9 + 4 * 12;
    const noteIndex = ((absoluteSemitone % 12) + 12) % 12;
    const octave = Math.floor(absoluteSemitone / 12);
    const snappedFreq = 440 * Math.pow(2, semitoneOffset / 12);
    return {
      frequency: snappedFreq,
      noteIndex: noteIndex,
      octave: octave,
      noteName: NOTE_NAMES[noteIndex] + octave,
    };
  }

  /**
   * Create a PianoRenderer.
   * @param {Object} options
   * @param {HTMLElement} options.keysEl      - container for piano key divs (#piano-keys)
   * @param {HTMLCanvasElement} options.canvasEl - canvas element (#pitch-canvas)
   * @param {HTMLElement} options.labelsEl    - container for labels (#labels-row)
   * @param {HTMLElement} options.wrapperEl   - scrollable wrapper (#piano-roll-wrapper)
   * @param {HTMLElement} options.scrollbackEl - scrollback controls container
   * @param {HTMLInputElement} options.sliderEl - scrollback range slider
   */
  function create(options) {
    const keysEl = options.keysEl;
    const canvasEl = options.canvasEl;
    const labelsEl = options.labelsEl;
    const wrapperEl = options.wrapperEl;
    const scrollbackEl = options.scrollbackEl;
    const sliderEl = options.sliderEl;

    const ctx = canvasEl.getContext('2d');

    let rootFrequency = null;
    let dataPoints = [];         // { frequency, columnIndex, dbLevel }
    let columns = [];            // { x, width, noteName, isBlack, frequency, octave }
    let totalRows = 0;
    let columnWidth = 0;
    let isScrolling = false;    // user is manually scrolling (paused/stopped)
    let autoScroll = true;

    /**
     * Build the column metadata and render the HTML key elements and labels.
     * Must be called once the container has a width.
     */
    function buildPianoKeys() {
      const containerWidth = keysEl.clientWidth;
      if (containerWidth <= 0) return;
      columnWidth = containerWidth / NUM_COLUMNS;

      columns = [];
      for (let i = 0; i < NUM_COLUMNS; i++) {
        columns.push({
          index: i,
          x: i * columnWidth,
          width: columnWidth,
          noteName: '',
          isBlack: false,
          isOctaveStart: false,
          octave: null,
          frequency: null,
        });
      }

      // Render piano key divs (neutral until root calibration)
      keysEl.innerHTML = '';
      for (const col of columns) {
        const div = document.createElement('div');
        div.className = 'piano-key white';
        div.dataset.index = col.index;
        keysEl.appendChild(div);
      }

      // Render labels row (empty until root calibration)
      labelsEl.innerHTML = '';
      for (const col of columns) {
        const cell = document.createElement('div');
        cell.className = 'label-cell';
        cell.dataset.index = col.index;

        const noteSpan = document.createElement('span');
        noteSpan.className = 'label-note';

        const freqSpan = document.createElement('span');
        freqSpan.className = 'label-freq';

        cell.appendChild(noteSpan);
        cell.appendChild(freqSpan);

        labelsEl.appendChild(cell);
      }
    }

    /**
     * Set the piano roll range and update column labels.
     */
    function calibrate(freq) {
      const snapped = snapToNote(freq);
      if (!snapped) return null;

      rootFrequency = snapped.frequency;

      for (let i = 0; i < NUM_COLUMNS; i++) {
        const semitoneOffset = i - OCTAVES_BELOW * SEMITONES_PER_OCTAVE;
        const absoluteSemitone = snapped.octave * 12 + snapped.noteIndex + semitoneOffset;
        const noteIndex = ((absoluteSemitone % 12) + 12) % 12;
        const octave = Math.floor(absoluteSemitone / 12);

        columns[i].noteName = NOTE_NAMES[noteIndex];
        columns[i].octave = octave;
        columns[i].isBlack = IS_BLACK[noteIndex];
        columns[i].isOctaveStart = (noteIndex === 0);
        columns[i].frequency = snapped.frequency * Math.pow(2, semitoneOffset / 12);
      }

      // Update key divs with correct black/white classes
      const keyDivs = keysEl.querySelectorAll('.piano-key');
      keyDivs.forEach(div => {
        const idx = parseInt(div.dataset.index, 10);
        const col = columns[idx];
        div.className = 'piano-key ' + (col.isBlack ? 'black' : 'white') +
                        (col.isOctaveStart ? ' octave-start' : '');
      });

      // Update label cells with actual note names, octaves and frequencies
      const cells = labelsEl.querySelectorAll('.label-cell');
      cells.forEach(cell => {
        const idx = parseInt(cell.dataset.index, 10);
        const col = columns[idx];
        const noteSpan = cell.querySelector('.label-note');
        const freqSpan = cell.querySelector('.label-freq');

        noteSpan.textContent = col.isOctaveStart ? col.noteName + col.octave : col.noteName;
        freqSpan.textContent = col.frequency !== null ? Math.round(col.frequency) + ' Hz' : '\u2014';
      });

      return snapped;
    }

    /**
     * Add a data point from pitch detection.
     * @param {number|null} frequency - detected frequency, or null if below threshold
     * @param {number} dbLevel
     */
    function addDataPoint(frequency, dbLevel) {
      // Lazy-build piano keys if not initialized yet (e.g. on slow mobile layout)
      if (columns.length === 0) {
        buildPianoKeys();
        if (columns.length === 0) return; // still no width available, skip
      }

      let columnIndex = -1;

      if (frequency !== null && rootFrequency !== null) {
        const semitoneOffset = 12 * Math.log2(frequency / rootFrequency);
        const rounded = Math.round(semitoneOffset);
        // Map to column: root = column 12
        const col = rounded + OCTAVES_BELOW * SEMITONES_PER_OCTAVE;
        if (col >= 0 && col < NUM_COLUMNS) {
          columnIndex = col;
        }
      }

      dataPoints.push({
        frequency: frequency,
        columnIndex: columnIndex,
        dbLevel: dbLevel,
      });

      totalRows++;
      resizeCanvas();

      // Auto-scroll to newest (top) before render so the correct viewport is drawn
      if (autoScroll) {
        wrapperEl.scrollTop = 0;
      }

      render();
    }

    /**
     * Resize the canvas and piano keys container to match total rows.
     */
    function resizeCanvas() {
      const height = totalRows * PIXELS_PER_ROW;
      const width = keysEl.clientWidth;

      keysEl.style.height = height + 'px';

      const dpr = window.devicePixelRatio || 1;
      canvasEl.width = width * dpr;
      canvasEl.height = height * dpr;
      canvasEl.style.width = width + 'px';
      canvasEl.style.height = height + 'px';

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    /**
     * Render the visible portion of the pitch plot onto the canvas.
     */
    function render() {
      const width = keysEl.clientWidth;
      const height = totalRows * PIXELS_PER_ROW;
      if (width <= 0 || height <= 0) return;

      // Determine visible range based on scroll position
      const scrollTop = wrapperEl.scrollTop;
      const viewHeight = wrapperEl.clientHeight;

      // Data is newest-at-top: row (totalRows-1) is at y≈0, row 0 at bottom.
      // scrollTop=0 shows newest data; scrollTop=max shows oldest.
      const firstVisibleRow = Math.max(0, totalRows - Math.ceil((scrollTop + viewHeight) / PIXELS_PER_ROW));
      const lastVisibleRow = Math.min(
        totalRows - 1,
        totalRows - 1 - Math.floor(scrollTop / PIXELS_PER_ROW)
      );

      ctx.clearRect(0, 0, width, height);

      if (dataPoints.length === 0 || columnWidth <= 0) return;

      ctx.strokeStyle = PLOT_COLOR;
      ctx.lineWidth = PLOT_LINE_WIDTH;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // Render pitch line. Data point index 0 = oldest (bottom), last = newest (top).
      // y position: newest at top (small y), oldest at bottom (large y).
      // Continuous segments of valid points are stroked as one polyline.
      // Gaps (columnIndex < 0) break the path.

      let segmentActive = false;

      for (let i = firstVisibleRow; i <= lastVisibleRow; i++) {
        const dp = dataPoints[i];

        if (dp.columnIndex < 0) {
          if (segmentActive) {
            ctx.stroke();
            ctx.beginPath();
            segmentActive = false;
          }
          continue;
        }

        const col = columns[dp.columnIndex];
        const x = col.x + col.width / 2;
        const y = (totalRows - 1 - i) * PIXELS_PER_ROW + PIXELS_PER_ROW / 2;

        if (!segmentActive) {
          ctx.beginPath();
          ctx.moveTo(x, y);
          segmentActive = true;
        } else {
          ctx.lineTo(x, y);
        }
      }

      if (segmentActive) {
        ctx.stroke();
      }
    }

    /**
     * Clear all data and reset the canvas.
     */
    function clear() {
      dataPoints = [];
      totalRows = 0;
      rootFrequency = null;
      columns.forEach(c => {
        c.frequency = null;
        c.noteName = '';
        c.octave = null;
        c.isBlack = false;
        c.isOctaveStart = false;
      });

      const width = keysEl.clientWidth;
      keysEl.style.height = '0px';
      canvasEl.width = width;
      canvasEl.height = 0;
      canvasEl.style.width = width + 'px';
      canvasEl.style.height = '0px';

      // Reset key divs to neutral white
      const keyDivs = keysEl.querySelectorAll('.piano-key');
      keyDivs.forEach(div => {
        div.className = 'piano-key white';
      });

      // Reset labels
      const cells = labelsEl.querySelectorAll('.label-cell');
      cells.forEach(cell => {
        const noteSpan = cell.querySelector('.label-note');
        const freqSpan = cell.querySelector('.label-freq');
        if (noteSpan) noteSpan.textContent = '\u2014';
        if (freqSpan) freqSpan.textContent = '\u2014';
        cell.classList.remove('root');
      });
    }

    /**
     * Enable/disable auto-scroll (recording = auto-scroll on, paused = off but user can manually scroll).
     */
    function setAutoScroll(enable) {
      autoScroll = enable;
      if (enable) {
        wrapperEl.classList.add('auto-scroll');
      } else {
        wrapperEl.classList.remove('auto-scroll');
      }
    }

    /**
     * Show or hide the scrollback controls.
     */
    function showScrollbackControls(show) {
      if (show) {
        scrollbackEl.classList.add('visible');
        updateSlider();
      } else {
        scrollbackEl.classList.remove('visible');
      }
    }

    /**
     * Update the scrollback slider range and value.
     */
    function updateSlider() {
      if (totalRows <= 0) {
        sliderEl.max = 0;
        sliderEl.value = 0;
        return;
      }
      const maxScroll = Math.max(0, totalRows * PIXELS_PER_ROW - wrapperEl.clientHeight);
      sliderEl.max = maxScroll;
      sliderEl.value = wrapperEl.scrollTop;
    }

    /**
     * Scroll to the position indicated by the slider.
     */
    function scrollToSlider() {
      wrapperEl.scrollTop = parseInt(sliderEl.value, 10);
      // render() will be called by the scroll event listener
    }

    /**
     * Scroll to latest (top).
     */
    function scrollToLatest() {
      wrapperEl.scrollTop = 0;
      if (sliderEl) sliderEl.value = 0;
      // render() will be called by the scroll event listener
    }

    // --- Event listeners ---
    wrapperEl.addEventListener('scroll', () => {
      if (dataPoints.length > 0) {
        render();
      }
      if (!autoScroll && scrollbackEl.classList.contains('visible')) {
        updateSlider();
      }
    });

    // Rebuild on resize
    window.addEventListener('resize', () => {
      if (columns.length > 0) {
        buildPianoKeys();
        if (rootFrequency) calibrate(rootFrequency);
        resizeCanvas();
        render();
      }
    });

    return {
      buildPianoKeys,
      calibrate,
      addDataPoint,
      clear,
      setAutoScroll,
      showScrollbackControls,
      updateSlider,
      scrollToSlider,
      scrollToLatest,
    };
  }

  return { create };
})();
