# Melody Plotter

A browser-based tool that visualizes the pitch of a whistled or sung melody on a piano roll.

## What it does

1. Captures microphone audio via the Web Audio API.
2. Runs FFT analysis to find the dominant frequency in each time slice.
4. Plots pitches on a fixed C5–C7 piano roll (25 semitones), scrolling from top (newest) to bottom (oldest).
5. When paused, lets you scroll back through recorded history.

## Design Decisions

### Pitch detection

FFT with 4096-point window and no smoothing, sampled every 40 ms (~25 fps). Parabolic interpolation refines the peak bin for better frequency resolution. Signals below -25 dB are treated as silence and not plotted. These parameters target whistling in the 500-2000 Hz range, where 4096-point FFT at common sample rates gives roughly 5-10 Hz bin spacing (under half a semitone at 500 Hz).

### Piano roll layout

25 equal-width chromatic columns (C5 through C7), colored to distinguish natural notes from sharps/flats — the same visual convention as a DAW piano roll. The piano key background and column labels are static HTML. Column headers show note name (with octave numbers on C) and frequency in Hertz. Frequencies map continuously to pixel positions via standard MIDI math (A4 = 440 Hz, C5 = MIDI 72).

### Scrolling model

The piano key background is built from HTML divs. A transparent canvas overlays it and draws only the red pitch line. Both layers grow vertically as data accumulates (4 px per sample). A scrollable container holds both; during recording it auto-scrolls to keep the newest data visible at the top. When paused, native scroll and a range slider let you navigate history.

### Browser support

Uses only standard Web APIs (MediaDevices, AudioContext, AnalyserNode, Canvas 2D). No third-party libraries. Works in Chrome, Edge, and Firefox on desktop and mobile.
