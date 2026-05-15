# Melody Plotter

A browser-based tool that visualizes the pitch of a whistled or sung melody on a piano roll.

## What it does

1. Captures microphone audio via the Web Audio API.
2. Runs FFT analysis to find the dominant frequency in each time slice.
4. Plots pitches on a 3-octave piano roll (centered around first detected tone), scrolling from top (newest) to bottom (oldest).
5. When paused, lets you scroll back through recorded history.

## Design Decisions

### Pitch detection

FFT with 4096-point window and no smoothing, sampled every 40 ms (~25 fps). Parabolic interpolation refines the peak bin for better frequency resolution. Signals below -25 dB are treated as silence and not plotted. These parameters target whistling in the 500-2000 Hz range, where 4096-point FFT at common sample rates gives roughly 5-10 Hz bin spacing (under half a semitone at 500 Hz).

### Piano roll layout

36 equal-width chromatic columns, colored to distinguish natural notes from sharps/flats — the same visual convention as a DAW piano roll. Column header labels show note name and frequency in Hertz.

### Scrolling model

The piano key background is built from HTML divs. A transparent canvas overlays it and draws only the red pitch line. Both layers grow vertically as data accumulates (4 px per sample). A scrollable container holds both; during recording it auto-scrolls to keep the newest data visible at the top. When paused, native scroll and a range slider let you navigate history.

### Browser support

Uses only standard Web APIs (MediaDevices, AudioContext, AnalyserNode, Canvas 2D). No third-party libraries. Works in Chrome, Edge, and Firefox on desktop and mobile.
