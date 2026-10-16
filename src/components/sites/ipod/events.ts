import { useEffect, useRef } from "react";

/**
 * Click-wheel input is broadcast as window events so any view (including the
 * canvas game engines) can listen without prop drilling.
 */
export type IpodEvent =
  | "menuclick"
  | "menulongpress"
  | "centerclick"
  | "centerlongclick"
  | "forwardclick"
  | "backwardclick"
  | "playpauseclick"
  | "forwardscroll"
  | "backwardscroll";

export type ScrollDirection = "clockwise" | "counter-clockwise";
export type ScrollEventDetail = { velocity: number };

export const dispatchIpodEvent = (name: IpodEvent) =>
  window.dispatchEvent(new Event(name));

export const dispatchScrollEvent = (
  direction: ScrollDirection,
  velocity = 0
) =>
  window.dispatchEvent(
    new CustomEvent<ScrollEventDetail>(
      direction === "clockwise" ? "forwardscroll" : "backwardscroll",
      { detail: { velocity } }
    )
  );

export const dispatchKeyboardEvent = (key: string) => {
  switch (key) {
    case "ArrowUp":
    case "ArrowLeft":
      dispatchScrollEvent("counter-clockwise");
      break;
    case "ArrowDown":
    case "ArrowRight":
      dispatchScrollEvent("clockwise");
      break;
    case "Enter":
      dispatchIpodEvent("centerclick");
      break;
    case " ":
    case "Spacebar":
      dispatchIpodEvent("playpauseclick");
      break;
    case "Escape":
      dispatchIpodEvent("menuclick");
      break;
  }
};

/** Subscribes to a window event, always calling the latest handler. */
export const useWindowEvent = <TEvent extends Event = Event>(
  eventName: IpodEvent | "keydown",
  handler: (event: TEvent) => void
) => {
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => {
    const listener = (event: Event) => handlerRef.current(event as TEvent);
    window.addEventListener(eventName, listener);
    return () => window.removeEventListener(eventName, listener);
  }, [eventName]);
};
