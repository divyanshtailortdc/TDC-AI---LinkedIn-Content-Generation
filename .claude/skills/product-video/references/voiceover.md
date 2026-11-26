# Voice-Over, Music and Captions

Narration turns a tour into an explanation. The toolkit gives you timing to write against, holds scenes until their audio ends, mixes the soundtrack and writes captions. Who writes and voices the script is the user's call.

## Two Ways to Work

**Picture first** (most common):

1. Record the video, even with rough scenes.
2. Open `<name>.script.md` next to the config. Each segment lists its speaking window and a word budget at about 145 words a minute.
3. Write `narration` for each segment in the config, run the video script with `--export`, and read the sheet again: it flags lines that run over.
4. Produce the audio, set each segment's `voiceover` file, and re-record the segments whose timing changed. They hold until their audio ends.

**Voice first** (when the story leads):

1. Write the full script with the user, one paragraph per segment.
2. Produce one audio file per segment.
3. Set `narration` and `voiceover` on each segment, then record. Every scene stretches to fit its line; make `act` fill the time with motion that matches what the voice says.

## Writing Narration

- Write for the ear: short sentences, one idea each, words people say aloud.
- Say what the viewer gets, not what the button is called. "See which competitor wins each question" beats "The competitors tab shows a table."
- Match the words to the screen: mention a thing when it is visible, not before.
- Leave breathing room. A segment packed to its full budget feels rushed; aim for 70 to 90% of it.
- Keep the product's own terms and claims accurate. Read the UI and the code.
- Offer the user a draft to edit rather than asking them to write from scratch.

## Producing the Audio

Ask the user which of these they want. Don't send their script to a paid or third-party service without approval.

- **Their own recording:** export one clip per segment, or one file for the whole video with `audio.voiceover` and `audio.voiceoverAt`.
- **A text-to-speech service or model they choose:** generate one file per segment from the `narration` text. Keep the same voice and settings for every segment.
- **A local tool** already installed, such as `espeak-ng` or `say`, for drafts and timing tests.

Any format ffmpeg reads works (WAV, MP3, M4A). Trim leading and trailing silence so timing stays tight.

## Music

- Set `audio.music` to a file you have the rights to use. It loops, fades in and out, and sits at `audio.musicVolume` (0.15 under narration, 0.35 without, by default).
- Let the user pick the mood. Calm product tours suit soft ambient tracks; trailers suit a clear beat you can cut to.

## Captions

When segments have `narration`, the export writes `<name>.vtt` with one cue per sentence, timed to the audio or estimated from the word count. Add it to the page with a `<track>` element. For social feeds, where sound is usually off, burn captions into the picture instead: extend the ffmpeg export with the `subtitles` filter, or show them on screen during recording.

## Checking

- Listen to the whole video: no clipped words, no overlap between segments, music never drowns the voice.
- Measure levels if something sounds off: `ffmpeg -i video.mp4 -af volumedetect -f null -` reports the mean volume; speech should sit well above the music.
- Confirm the captions match what is said.
