# Story and Pacing Ideas

These are starting points drawn from videos that worked. Break any of them when the user's idea calls for it.

## Pick a Shape

Match the shape to where the video plays and what the viewer should do next.

| Shape | Good for | Typical feel |
| --- | --- | --- |
| Guided tour | Homepage, demo page, sales follow-up | Numbered steps through the product's core loop, calm cursor, captions or narration |
| Launch trailer | Announcements, social posts | Fast cuts, bold type, music-led, 15 to 45 seconds |
| Feature clip | Changelog, docs, onboarding emails | One task from start to finish, 10 to 30 seconds |
| Tutorial | Help center, onboarding | Narrated, slower, every click visible, any length the task needs |
| Problem, then solution | Landing pages, ads | Show the pain first (the messy spreadsheet), then the product fixing it |
| Before and after | Case studies, impact stories | The same screen or metric, then and now |
| Hero loop | Behind a headline | Silent, no cursor, slow motion across 4 or 5 screens, seamless |
| Vertical cut | Stories, reels, shorts | Phone viewport or cropped screens, large text, captions always on |

## Build the Story

- Start from the viewer's problem or goal, then show the moments that solve it. A feature list is not a story.
- Give each segment one idea. If a screen needs two ideas, make two segments.
- Show outcomes before settings: the chart that moved before the form that configured it.
- End on something the viewer can do: start free, book a demo, read the docs.
- Only claim what the product does. Read the screen and the code before writing on-screen text or narration.

## Make Screens Look Their Best

- Open each screen on its most impressive state, with data filled in and the right item selected. URL parameters beat clicking through menus.
- Hide what distracts: dev tools, cookie banners, empty sidebars. Use `hide` and `prepare`, or inject CSS through `theme.css` or `page.eval`.
- Point at what the viewer should notice: move the cursor there, highlight it, zoom in, or dim everything else. The toolkit's scenes are plain JavaScript, so any of these is possible.

## Motion and Rhythm

Starting values for a calm tour. Faster styles want shorter pauses and more cuts.

- Pause 0.5 to 1 second after moving to something the viewer should read.
- Scroll 300 to 600 pixels over 1.2 to 1.6 seconds; jumps read as glitches.
- Sweep across charts slowly so tooltips follow.
- Hold the last frame of a segment about 1 second before the transition.
- Fades from a dark card to a bright screen feel harsh under 0.6 seconds.
- When narration drives the video, let the voice set the timing: give segments a `voiceover` file and they hold until it ends.

## On-Screen Text

- Title cards and captions are optional. Narration, a single caption line, or no text at all can each be right.
- Keep text short enough to read twice in the time it shows.
- Write outcomes ("Find out why you lose") rather than feature names ("Gap analysis module").
- For sound-off viewing (social feeds, autoplay), put the story in on-screen text or burned-in captions.

## Review With Fresh Eyes

- Does the story make sense to someone who has never seen the product?
- Watch once with sound off and once with sound on, if it has sound.
- Is there a moment the viewer waits for nothing? Cut it.
- Would the user be proud to post it? If not, ask what feels off before polishing details.
