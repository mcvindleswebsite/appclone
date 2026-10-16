"use client";

import { useEffect, useRef, useState } from "react";

import { useViewContext } from "../ipod-context";
import { useMenuHideView } from "../use-selectable-list";
import styles from "../ipod.module.css";
import BrickGame from "./brick/Game";
import SolitaireGame from "./solitaire/Game";

type Dimensions = { width: number; height: number };

const useContainerSize = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Dimensions>({ width: 0, height: 0 });

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const width = Math.floor(entry.contentRect.width);
      const height = Math.floor(entry.contentRect.height);
      setSize((prev) =>
        prev.width === width && prev.height === height ? prev : { width, height }
      );
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { containerRef, size };
};

const getDpr = () => (typeof window === "undefined" ? 1 : window.devicePixelRatio || 1);

export const BrickGameView = () => {
  useMenuHideView("brickGame");
  const { hideView } = useViewContext();
  const { containerRef, size } = useContainerSize();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dpr] = useState(getDpr);
  const ready = size.width > 0 && size.height > 0;

  useEffect(() => {
    const context = canvasRef.current?.getContext("2d");
    if (!ready || !context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    const game = new BrickGame(size.width, size.height, hideView);
    game.init();
    return () => game.cleanup();
    // The engine is created once per mount; it doesn't support live resizing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, dpr, hideView]);

  return (
    <div ref={containerRef} className={styles.brickRoot}>
      <canvas
        ref={canvasRef}
        id="brickBreakerCanvas"
        className={styles.gameCanvas}
        width={size.width * dpr}
        height={size.height * dpr}
        style={{ width: size.width, height: size.height }}
      >
        Your browser does not support this feature
      </canvas>
    </div>
  );
};

export const SolitaireGameView = () => {
  const { hideView } = useViewContext();
  const { containerRef, size } = useContainerSize();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<SolitaireGame | null>(null);
  const [dpr] = useState(getDpr);
  const ready = size.width > 0 && size.height > 0;

  useEffect(() => {
    const context = canvasRef.current?.getContext("2d");
    if (!ready || !context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    const game = new SolitaireGame(size.width, size.height, hideView);
    game.init();
    gameRef.current = game;
    return () => {
      game.cleanup();
      gameRef.current = null;
    };
    // Created once; later size changes go through game.resize below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, dpr, hideView]);

  useEffect(() => {
    const context = canvasRef.current?.getContext("2d");
    if (!gameRef.current || !context || !ready) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    gameRef.current.resize(size.width, size.height);
  }, [size, dpr, ready]);

  return (
    <div ref={containerRef} className={styles.solitaireRoot}>
      <canvas
        ref={canvasRef}
        id="solitaireCanvas"
        className={styles.gameCanvas}
        width={size.width * dpr}
        height={size.height * dpr}
        style={{ width: size.width, height: size.height }}
      >
        Your browser does not support this feature
      </canvas>
    </div>
  );
};
