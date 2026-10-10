import type { GazeSample, Point2 } from '@iris/protocol';

const POINTS_PER_IRIS = 5; // center, then four contour points
const TRAIL_LENGTH = 20;
const RED = '255, 40, 40';

/**
 * Draws on the camera preview: a bright red ring around each iris, a dot at its
 * center, and a short fading trail of recent iris positions. Drawing only;
 * nothing is recorded or stored.
 */
export class EyeTrace {
  readonly overlay = document.createElement('canvas');
  readonly readout = document.createElement('p');
  private trails: Point2[][] = [[], []];

  constructor(private readonly video: HTMLVideoElement) {
    this.overlay.className = 'trace-overlay';
  }

  drawPoints(points: Point2[]): void {
    const scale = window.devicePixelRatio || 1;
    const canvas = this.overlay;
    canvas.width = canvas.clientWidth * scale;
    canvas.height = canvas.clientHeight * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (points.length < POINTS_PER_IRIS * 2) {
      this.trails = [[], []];
      return;
    }
    // Match the video's object-fit: cover crop (fullscreen), which is a no-op in the panel.
    const vw = this.video.videoWidth || canvas.width;
    const vh = this.video.videoHeight || canvas.height;
    const fit = Math.max(canvas.width / vw, canvas.height / vh);
    const [dw, dh] = [vw * fit, vh * fit];
    const [ox, oy] = [(canvas.width - dw) / 2, (canvas.height - dh) / 2];
    const toPixels = (p: Point2): Point2 => ({ x: ox + p.x * dw, y: oy + p.y * dh });
    const size = Math.max(scale, dw / 500); // grow the markers with the picture
    ctx.shadowColor = `rgb(${RED})`;
    ctx.shadowBlur = 8 * size;

    for (let eye = 0; eye < 2; eye++) {
      const [center, ...contour] = points.slice(eye * POINTS_PER_IRIS, (eye + 1) * POINTS_PER_IRIS).map(toPixels);
      if (!center) continue;
      const trail = [...this.trails[eye]!, center].slice(-TRAIL_LENGTH);
      this.trails[eye] = trail;

      trail.forEach((p, i) => {
        ctx.fillStyle = `rgba(${RED}, ${((i + 1) / trail.length) * 0.6})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.5 * size, 0, Math.PI * 2);
        ctx.fill();
      });

      const radius = contour.reduce((sum, p) => sum + Math.hypot(p.x - center.x, p.y - center.y), 0) / contour.length;
      ctx.strokeStyle = `rgb(${RED})`;
      ctx.lineWidth = 2 * size;
      ctx.beginPath();
      ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = `rgb(${RED})`;
      ctx.beginPath();
      ctx.arc(center.x, center.y, 2.5 * size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  addSample(sample: GazeSample): void {
    const eye = sample.eye ? `x ${sample.eye.x.toFixed(2)}  y ${sample.eye.y.toFixed(2)}` : 'not tracked';
    this.readout.textContent =
      `Eyes ${eye} | Head yaw ${sample.head.yaw.toFixed(2)} pitch ${sample.head.pitch.toFixed(2)}`;
  }
}
