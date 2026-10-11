// Iris landing page: scroll reveals and the gaze demo.
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Fade sections in as they scroll into view.
const revealObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (entry.isIntersecting) {
      entry.target.classList.add("is-visible");
      revealObserver.unobserve(entry.target);
    }
  }
}, { threshold: 0.15 });
document.querySelectorAll(".reveal").forEach((el, i) => {
  el.style.transitionDelay = `${(i % 3) * 100}ms`;
  revealObserver.observe(el);
});

// Gaze demo: the ring snaps to a numbered target, then a double blink opens it.
const page = document.getElementById("demo-page");
const gaze = document.getElementById("gaze");
const status = document.getElementById("demo-status");
const targets = [...page.querySelectorAll(".target")];

function aimAt(target) {
  const box = target.getBoundingClientRect();
  const pageBox = page.getBoundingClientRect();
  gaze.style.left = `${box.left - pageBox.left + box.width / 2}px`;
  gaze.style.top = `${box.top - pageBox.top + box.height / 2}px`;
  targets.forEach((t) => t.classList.toggle("is-aimed", t === target));
}

async function blink() {
  gaze.classList.add("is-hidden"); // the cursor hides while the eyes are closed
  await wait(160);
  gaze.classList.remove("is-hidden");
  await wait(220);
}

async function runDemo() {
  const order = [1, 3, 0, 2];
  for (let i = 0; ; i = (i + 1) % order.length) {
    const target = targets[order[i]];
    status.textContent = "Looking";
    aimAt(target);
    await wait(1400);
    status.textContent = `Aimed at ${target.dataset.n}, blink twice to open`;
    await wait(900);
    await blink();
    await blink();
    target.classList.add("is-clicked");
    status.textContent = `Opened ${target.textContent}`;
    await wait(1100);
    target.classList.remove("is-clicked");
  }
}

if (reducedMotion) {
  aimAt(targets[1]);
  status.textContent = "Aimed at 2, blink twice to open";
} else {
  runDemo();
}
