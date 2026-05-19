/**
 * AudioProcessor - Handles microphone capture, FFT analysis, and pitch detection.
 *
 * Uses AnalyserNode (FFT) to detect the dominant frequency in the audio signal.
 */

const AudioProcessor = (function () {
  // --- Tunable constants ---
  const MIN_DB_THRESHOLD = -25;   // dB below which signal is treated as silence
  const FFT_SIZE = 4096;          // FFT window size (good resolution for whistling)
  const SAMPLE_INTERVAL_MS = 40;  // ~25 fps pitch detection

  /**
   * Convert an FFT bin index to frequency (Hz) given sample rate and FFT size.
   */
  function binToFrequency(binIndex, sampleRate, fftSize) {
    return (binIndex * sampleRate) / fftSize;
  }

  /**
   * Convert raw FFT magnitude (0..255) to approximate dB.
   * The AnalyserNode returns byte frequency data (0-255), where 255 is 0 dBFS.
   * We use 20*log10(value/255) as an approximation.
   */
  function magnitudeToDb(magnitude) {
    if (magnitude <= 0) return -Infinity;
    return 20 * Math.log10(magnitude / 255);
  }

  /**
   * Simple parabolic interpolation to refine the peak frequency estimate.
   * Given three points (index-1, index, index+1) and their magnitudes, estimate the
   * true peak position as a fractional bin index.
   */
  function interpolatePeak(binIndex, mags) {
    const left  = mags[binIndex - 1] || 0;
    const mid   = mags[binIndex];
    const right = mags[binIndex + 1] || 0;
    const denom = 2 * mid - left - right;
    if (denom === 0) return binIndex;
    return binIndex + (right - left) / (2 * denom);
  }

  /**
   * Create a new AudioProcessor.
   * @param {Object} callbacks - { onPitch, onStatus }
   *   onPitch(frequencyHz, dbLevel) - called every detection cycle
   *   onStatus(message) - status text updates
   */
  function create(callbacks) {
    const cb = callbacks || {};

    let audioContext = null;
    let analyser = null;
    let stream = null;
    let source = null;
    let isRunning = false;
    let isPaused = false;
    let timerId = null;
    let buffer = null;          // Uint8Array for FFT output

    /**
     * Request microphone access and start processing.
     * @returns {Promise<void>}
     */
    async function start() {
      if (isRunning && !isPaused) return;

      if (isPaused) {
        isPaused = false;
        scheduleNext();
        if (cb.onStatus) cb.onStatus('Recording...');
        return;
      }

      // Fresh start
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        });

        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        // iOS Safari may create the context in "suspended" state even after
        // a user gesture; resume it explicitly.
        if (audioContext.state === 'suspended') {
          await audioContext.resume();
        }
        const sampleRate = audioContext.sampleRate;

        analyser = audioContext.createAnalyser();
        analyser.fftSize = FFT_SIZE;
        analyser.smoothingTimeConstant = 0; // no smoothing for accurate peaks

        source = audioContext.createMediaStreamSource(stream);
        source.connect(analyser);
        // Do NOT connect to destination – we don't want feedback

        buffer = new Uint8Array(analyser.frequencyBinCount);
        isRunning = true;
        isPaused = false;

        if (cb.onStatus) cb.onStatus('Recording...');
        scheduleNext();
      } catch (err) {
        console.error('Microphone access failed:', err);
        if (cb.onStatus) cb.onStatus('Error: ' + err.message);
        throw err;
      }
    }

    /**
     * Pause processing (keep stream alive).
     */
    function pause() {
      if (!isRunning || isPaused) return;
      isPaused = true;
      if (timerId) clearTimeout(timerId);
      timerId = null;
      if (cb.onStatus) cb.onStatus('Paused');
    }

    /**
     * Fully stop: release mic.
     */
    function stop() {
      isRunning = false;
      isPaused = false;
      if (timerId) {
        clearTimeout(timerId);
        timerId = null;
      }
      if (source) {
        source.disconnect();
        source = null;
      }
      if (stream) {
        stream.getTracks().forEach(t => t.stop());
        stream = null;
      }
      if (audioContext && audioContext.state !== 'closed') {
        audioContext.close().catch(() => {});
        audioContext = null;
      }
      analyser = null;
      buffer = null;
      if (cb.onStatus) cb.onStatus('Stopped');
    }

    /**
     * Schedule the next processing frame.
     */
    function scheduleNext() {
      if (!isRunning || isPaused) return;
      timerId = setTimeout(() => {
        processFrame();
        scheduleNext();
      }, SAMPLE_INTERVAL_MS);
    }

    /**
     * Process one FFT frame: find peak, detect root, invoke callbacks.
     */
    function processFrame() {
      if (!analyser || !buffer) return;

      analyser.getByteFrequencyData(buffer);

      const fftSize = analyser.fftSize;
      const sampleRate = audioContext.sampleRate;
      const binCount = buffer.length;

      // Find the frequency bin with maximum magnitude
      let maxMag = 0;
      let maxBin = -1;
      for (let i = 0; i < binCount; i++) {
        if (buffer[i] > maxMag) {
          maxMag = buffer[i];
          maxBin = i;
        }
      }

      if (maxBin < 0) return;

      const dbLevel = magnitudeToDb(maxMag);

      // Skip if below threshold
      if (dbLevel < MIN_DB_THRESHOLD) {
        if (cb.onPitch) cb.onPitch(null, dbLevel);
        return;
      }

      // Refine peak with parabolic interpolation
      const refinedBin = interpolatePeak(maxBin, buffer);
      const frequency = binToFrequency(refinedBin, sampleRate, fftSize);

      if (cb.onPitch) cb.onPitch(frequency, dbLevel);
    }

    return {
      start,
      pause,
      stop,
    };
  }

  return { create };
})();
