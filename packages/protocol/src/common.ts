/** Primitives shared by every sensor contract. */

export interface Point2 {
  x: number;
  y: number;
}

export type Unsubscribe = () => void;
