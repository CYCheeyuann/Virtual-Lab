# Expedition background media

The Welcome page no longer plays any video. Both the opening hero video and the
scrolling environmental video have been removed from the active home page.

## Current behaviour

- The active `welcome.html` plays no video: there is no opening hero video and no
  scrolling environmental video. The page does not reference or load any `.mp4`.
- `science-expedition-hero.png` is the background used for both the hero and the
  scrolling image exploration below it. It is now the real exploration image, not
  just a poster waiting for a video to load.
- The exploration image still scales and re-frames as you scroll (CSS
  transform / transform-origin driven by the scroll logic).
- The standalone 90-second Field Film page, its navigation and in-page entries,
  and its timeline have all been removed.

## Archived source files (not loaded by the active home page)

The two MP4 files below are kept only as unused source assets. The active home
page does not reference or load them. Listing these names here is documentation,
not an active load reference.

- `expedition-master.mp4` — former looping environmental animation.
- `expedition-camera-master.mp4` — former Higgsfield-native opening hero camera move.

## Notes

- `welcome-video.js` keeps its original file name. It currently drives the image
  exploration and scroll interaction only; the word "video" in its name does not
  mean any video is still playing.
