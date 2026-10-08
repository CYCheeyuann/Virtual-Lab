(function () {
  'use strict';

  function element(tag, className, styles) {
    const node = document.createElement(tag);
    node.className = className;
    Object.entries(styles || {}).forEach(([name, value]) => node.style.setProperty(name, value));
    return node;
  }

  function buildStars() {
    const sky = element('div', 'scene-fx fx-sky');
    for (let index = 0; index < 42; index += 1) {
      const star = element('i', 'fx-star', {
        '--star-x': `${5 + ((index * 37) % 91)}%`,
        '--star-y': `${4 + ((index * 53) % 82)}%`,
        '--star-size': `${1 + (index % 4) * .72}px`,
        '--star-delay': `${-((index * .37) % 4.8)}s`,
        '--star-duration': `${2.2 + (index % 7) * .48}s`
      });
      sky.appendChild(star);
    }
    return sky;
  }

  function buildBirds() {
    const birds = element('div', 'scene-fx fx-birds');
    const heights = [18, 27, 33, 14, 41, 23, 36];
    heights.forEach((height, index) => {
      birds.appendChild(element('i', 'fx-bird', {
        '--bird-y': `${height}%`,
        '--bird-size': `${18 + (index % 3) * 6}px`,
        '--bird-delay': `${index * 1.05 - 5.5}s`,
        '--bird-duration': `${8.5 + (index % 4) * 1.2}s`
      }));
    });
    return birds;
  }

  function buildWater() {
    const water = element('div', 'scene-fx fx-water');
    for (let index = 0; index < 10; index += 1) {
      water.appendChild(element('i', 'water-stream', {
        '--water-left': `${-8 + (index % 4) * 9}%`,
        '--water-bottom': `${8 + index * 7}%`,
        '--water-width': `${70 + (index % 3) * 35}px`,
        '--water-delay': `${-index * .55}s`,
        '--water-duration': `${3.2 + (index % 4) * .45}s`
      }));
    }
    for (let index = 0; index < 5; index += 1) {
      water.appendChild(element('b', 'water-ripple', {
        '--ripple-x': `${20 + index * 14}%`,
        '--ripple-y': `${32 + (index % 3) * 18}%`,
        '--ripple-delay': `${-index * .78}s`
      }));
    }
    return water;
  }

  function buildVolcano() {
    const volcano = element('div', 'scene-fx fx-volcano');
    volcano.appendChild(element('div', 'volcano-glow'));
    volcano.appendChild(element('div', 'volcano-core'));
    const sparkPaths = [
      [-7, -18], [5, -23], [-12, -14], [11, -20], [-3, -28], [16, -12], [-18, -10], [8, -31], [-10, -25], [20, -17], [1, -35], [-22, -16]
    ];
    sparkPaths.forEach(([x, y], index) => {
      volcano.appendChild(element('i', 'lava-spark', {
        '--spark-x': `${x}vw`,
        '--spark-x-end': `${x * 1.35}vw`,
        '--spark-y': `${y}vh`,
        '--spark-size': `${2 + (index % 4)}px`,
        '--spark-delay': `${-index * .23}s`,
        '--spark-duration': `${2.1 + (index % 5) * .3}s`
      }));
    });
    for (let index = 0; index < 7; index += 1) {
      volcano.appendChild(element('b', 'smoke-puff', {
        '--smoke-size': `${28 + (index % 4) * 15}px`,
        '--smoke-delay': `${-index * .72}s`,
        '--smoke-duration': `${4.5 + (index % 3) * .7}s`,
        '--smoke-drift': `${-8 + index * 2.4}vw`
      }));
    }
    return volcano;
  }

  document.addEventListener('DOMContentLoaded', () => {
    const camera = document.querySelector('[data-journey-camera]');
    if (!camera || camera.querySelector('.scene-effects-layer')) return;
    const layer = element('div', 'scene-effects-layer');
    layer.setAttribute('aria-hidden', 'true');
    layer.append(buildStars(), buildBirds(), buildWater(), buildVolcano());
    camera.appendChild(layer);
  });
})();
