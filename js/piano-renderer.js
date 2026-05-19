/**
 * PianoRenderer - Manages the canvas overlay for the pitch plot
 * on top of the static HTML piano roll (C5–C7, 25 semitones).
 * Handles scrollback and viewport-aware rendering.
 */

const PianoRenderer = (function () {
  // --- Tunable constants ---
  const PIXELS_PER_ROW = 4;        // vertical space per data point
  const PLOT_COLOR = '#ff4757';    // red pitch line
  const PLOT_LINE_WIDTH = 5;
  const PLOT_DOT_RADIUS = 3;

  // Fixed piano range: C5 (MIDI 72) to C7 (MIDI 96) = 25 semitones
  const C5_MIDI = 72;
  const NUM_COLUMNS = 25;          // C5 through C7 inclusive

  /**
   * Create a PianoRenderer.
   * @param {Object} options
   * @param {HTMLElement} options.keysEl      - container for piano key divs (#piano-keys)
   * @param {HTMLCanvasElement} options.canvasEl - canvas element (#pitch-canvas)
   * @param {HTMLElement} options.wrapperEl   - scrollable wrapper (#piano-roll-wrapper)
   * @param {HTMLElement} options.scrollbackEl - scrollback controls container
   * @param {HTMLInputElement} options.sliderEl - scrollback range slider
   */
  function create(options) {
    const keysEl = options.keysEl;
    const canvasEl = options.canvasEl;
    const wrapperEl = options.wrapperEl;
    const scrollbackEl = options.scrollbackEl;
    const sliderEl = options.sliderEl;

    const ctx = canvasEl.getContext('2d');

    let dataPoints = [];         // { frequency, xPos, dbLevel }
    let totalRows = 0;
    let columnWidth = 0;
    let columnsInitialized = false;
    let autoScroll = true;

    /**
     * Compute column x positions from container width.
     * Must be called once after layout.
     */
    function initColumns() {
      const containerWidth = keysEl.clientWidth;
      if (containerWidth <= 0) return;
      columnWidth = containerWidth / NUM_COLUMNS;
      columnsInitialized = true;
    }

    /**
     * Map a frequency to a pixel x position on the C5–C7 piano roll.
     * Returns null if frequency is out of range or NaN.
     */
    function frequencyToX(frequency) {
      if (frequency == null || frequency <= 0) return null;
      // MIDI note number: 69 = A4 (440 Hz)
      const midiNote = 69 + 12 * Math.log2(frequency / 440);
      const col = midiNote - C5_MIDI;
      // col 0 = left edge of C5, col NUM_COLUMNS = right edge of C7
      return (col + 0.5) * columnWidth;
    }

    /**
     * Add a data point from pitch detection.
     * @param {number|null} frequency - detected frequency, or null if below threshold
     * @param {number} dbLevel
     */
    function addDataPoint(frequency, dbLevel) {
      // Lazy-init columns if not yet done (e.g. slow mobile layout)
      if (!columnsInitialized) {
        initColumns();
        if (!columnsInitialized) return; // still no width, skip
      }

      const xPos = frequencyToX(frequency);

      dataPoints.push({
        frequency: frequency,
        xPos: xPos,
        dbLevel: dbLevel,
      });

      totalRows++;
      resizeCanvas();

      // Auto-scroll to newest (top)
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

      let segmentActive = false;

      for (let i = firstVisibleRow; i <= lastVisibleRow; i++) {
        const dp = dataPoints[i];

        if (dp.xPos == null) {
          if (segmentActive) {
            ctx.stroke();
            ctx.beginPath();
            segmentActive = false;
          }
          continue;
        }

        const x = dp.xPos;
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

      const width = keysEl.clientWidth;
      keysEl.style.height = '0px';
      canvasEl.width = width;
      canvasEl.height = 0;
      canvasEl.style.width = width + 'px';
      canvasEl.style.height = '0px';
    }

    /**
     * Enable/disable auto-scroll.
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
    }

    /**
     * Scroll to latest (top).
     */
    function scrollToLatest() {
      wrapperEl.scrollTop = 0;
      if (sliderEl) sliderEl.value = 0;
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

    // Rebuild column positions on resize
    window.addEventListener('resize', () => {
      if (columnsInitialized) {
        initColumns();
        resizeCanvas();
        render();
      }
    });

    return {
      initColumns,
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
