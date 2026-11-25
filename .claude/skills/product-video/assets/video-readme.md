# Product Videos

This folder records the product videos from the running app. Replace every `your_…` placeholder with this project's values, and delete the lines that don't apply.

## Requirements

- Node.js 22.18 or later, or Bun
- ffmpeg 5 or later and ffprobe on your `PATH`
- Chrome, Chromium, Brave or Edge. Set `CHROMIUM_PATH` if yours is installed somewhere unusual.

## Make the Video

1. Reseed the demo data: `your_seed_command`. The demo login is `your_demo_email`.
2. Start the app at `your_base_url`.
3. Close other heavy programs, then find what would make the video choppy: `your_preflight_command`.
4. Record and export: `your_video_command`. Choppy takes are redone automatically.
5. Check for flashes and choppy motion, and look at the contact sheet: `your_check_command`.

The export writes MP4, WebM, a poster image and captions to `your_output_folder`.

| Task                                      | Command                                |
| ----------------------------------------- | -------------------------------------- |
| Screenshot a page at the recording size   | `your_snap_command -- /your_page_path` |
| Re-record one scene                       | `your_video_command -- your_scene_key` |
| Rebuild after changing narration or music | `your_video_command -- --export`       |
| Record the silent homepage loop           | `your_video_command -- --loop`         |

## Change the Video

- **Scenes, captions and narration:** edit `tour.config.ts`. Each scene's `act` moves the cursor, clicks and scrolls. The comments in that file explain every option.
- **Narration timing:** after an export, open `your_video_name.script.md`. It lists each scene's speaking window and word budget.
- **Voice-over audio:** add the files to this folder and set `voiceover` on each scene.
- **Recording behavior:** the code in `toolkit/` belongs to this project. Change it when a video needs something new.

Record against a local or staging database, never production. Never click anything that changes real data, sends messages or spends money.
