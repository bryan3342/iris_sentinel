// Landing page motion. Three small behaviours, all decorative and all skipped
// when the visitor prefers reduced motion:
//   1. a gaze ring that trails the pointer and snaps to links, like Iris snaps to targets
//   2. sections that draw in once they scroll into view
//   3. a call-to-action pill that leans toward the pointer
(() => {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // 2. Reveal on scroll. Runs with or without motion so content never stays hidden.
  const revealed = document.querySelectorAll("[data-reveal]");
  if (reduced || !("IntersectionObserver" in window)) {
    revealed.forEach((el) => el.classList.add("is-in"));
  } else {
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-in");
        io.unobserve(entry.target);
      }
    }, { rootMargin: "0px 0px -12% 0px", threshold: 0.2 });
    revealed.forEach((el) => io.observe(el));
  }

  if (reduced || !matchMedia("(pointer: fine)").matches) return;

  // 1. Gaze ring.
  const ring = document.querySelector(".gaze");
  if (ring) {
    const SNAP_PAD = 14;
    let targetX = innerWidth / 2;
    let targetY = innerHeight / 2;
    let x = targetX;
    let y = targetY;
    let snapped = null;
    let shown = false;

    addEventListener("pointermove", (e) => {
      targetX = e.clientX;
      targetY = e.clientY;
      if (!shown) {
        shown = true;
        x = targetX;
        y = targetY;
        document.body.classList.add("has-gaze");
        ring.classList.add("is-on");
      }
    }, { passive: true });
    document.addEventListener("pointerleave", () => ring.classList.remove("is-on"));
    document.addEventListener("pointerenter", () => { if (shown) ring.classList.add("is-on"); });

    for (const el of document.querySelectorAll("a, button")) {
      el.addEventListener("pointerenter", () => { snapped = el; ring.classList.add("is-snapped"); });
      el.addEventListener("pointerleave", () => { if (snapped === el) { snapped = null; ring.classList.remove("is-snapped"); } });
    }

    const frame = () => {
      if (snapped) {
        const r = snapped.getBoundingClientRect();
        x += (r.left + r.width / 2 - x) * 0.22;
        y += (r.top + r.height / 2 - y) * 0.22;
        ring.style.width = `${r.width + SNAP_PAD}px`;
        ring.style.height = `${r.height + SNAP_PAD}px`;
        ring.style.borderRadius = getComputedStyle(snapped).borderRadius === "0px" ? "10px" : "999px";
      } else {
        x += (targetX - x) * 0.18;
        y += (targetY - y) * 0.18;
        ring.style.width = "";
        ring.style.height = "";
        ring.style.borderRadius = "";
      }
      ring.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  // 3. Magnetic call to action.
  for (const el of document.querySelectorAll("[data-magnetic]")) {
    const PULL = 0.28;
    el.addEventListener("pointermove", (e) => {
      const r = el.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      el.style.transform = `translate(${dx * PULL}px, ${dy * PULL}px)`;
    });
    el.addEventListener("pointerleave", () => { el.style.transform = ""; });
  }
})();
