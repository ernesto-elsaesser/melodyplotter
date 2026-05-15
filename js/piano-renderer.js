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
        const octave = Math.floor(i / SEMITONES_PER_OCTAVE) - OCTAVES_BELOW;
        const semitone = i % SEMITONES_PER_OCTAVE;
        const noteName = NOTE_NAMES[semitone];
        const isBlack = IS_BLACK[semitone];
        const isOctaveStart = (semitone === 0);

        columns.push({
          index: i,
          x: i * columnWidth,
          width: columnWidth,
          noteName: noteName,
          isBlack: isBlack,
          isOctaveStart: isOctaveStart,
          octave: octave,
          frequency: null, // set after root calibration
        });
      }

      // Render piano key divs
      keysEl.innerHTML = '';
      for (const col of columns) {
        const div = document.createElement('div');
        div.className = 'piano-key ' + (col.isBlack ? 'black' : 'white') +
                        (col.isOctaveStart ? ' octave-start' : '');
        div.dataset.index = col.index;
        keysEl.appendChild(div);
      }

      // Render labels row
      labelsEl.innerHTML = '';
      for (const col of columns) {
        const cell = document.createElement('div');
        cell.className = 'label-cell';
        cell.dataset.index = col.index;

        const noteSpan = document.createElement('span');
        noteSpan.className = 'label-note';
        noteSpan.textContent = col.noteName;

        const freqSpan = document.createElement('span');
        freqSpan.className = 'label-freq';
        freqSpan.textContent = '\u2014'; // em dash placeholder

        cell.appendChild(noteSpan);
        cell.appendChild(freqSpan);

        if (col.octave === 0 && col.noteName === 'C') {
          cell.classList.add('root');
        }

        labelsEl.appendChild(cell);
      }
    }

    /**
     * Set the root frequency and update column frequency labels.
     */
    function setRootFrequency(freq) {
      rootFrequency = freq;

      for (const col of columns) {
        const semitoneOffset = col.index - (OCTAVES_BELOW * SEMITONES_PER_OCTAVE);
        col.frequency = rootFrequency * Math.pow(2, semitoneOffset / SEMITONES_PER_OCTAVE);
      }

      // Update label cells
      const cells = labelsEl.querySelectorAll('.label-cell');
      cells.forEach(cell => {
        const idx = parseInt(cell.dataset.index, 10);
        const col = columns[idx];
        const freqSpan = cell.querySelector('.label-freq');
        if (col.frequency !== null) {
          freqSpan.textContent = Math.round(col.frequency) + ' Hz';
        }
      });
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
        // Map to column: root = column 12 (octave 0, C)
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
      render();

      // Auto-scroll to newest (top) during recording
      if (autoScroll) {
        wrapperEl.scrollTop = 0;
      }
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

      const firstVisibleRow = Math.floor(scrollTop / PIXELS_PER_ROW);
      const lastVisibleRow = Math.min(
        totalRows - 1,
        Math.ceil((scrollTop + viewHeight) / PIXELS_PER_ROW)
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
      columns.forEach(c => c.frequency = null);

      const width = keysEl.clientWidth;
      keysEl.style.height = '0px';
      canvasEl.width = width;
      canvasEl.height = 0;
      canvasEl.style.width = width + 'px';
      canvasEl.style.height = '0px';

      // Reset labels
      const cells = labelsEl.querySelectorAll('.label-cell');
      cells.forEach(cell => {
        const freqSpan = cell.querySelector('.label-freq');
        if (freqSpan) freqSpan.textContent = '\u2014';
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
        if (rootFrequency) setRootFrequency(rootFrequency);
        resizeCanvas();
        render();
      }
    });

    return {
      buildPianoKeys,
      setRootFrequency,
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
