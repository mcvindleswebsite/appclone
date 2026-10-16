"use client";

import { AnimatePresence, motion } from "motion/react";

import { useWindowEvent } from "./events";
import { useViewContext } from "./ipod-context";
import { PreviewPanel } from "./previews";
import { Header } from "./screen-parts";
import type { ViewInstance } from "./types";
import { VIEW_CONFIG } from "./view-config";
import { VIEW_COMPONENTS } from "./views";
import styles from "./ipod.module.css";

const tween = { duration: 0.3, ease: "linear" as const };

const slideRight = {
  initial: { x: "100%" },
  animate: { x: 0, transition: tween },
  exit: { x: "100%", transition: tween },
};

const noAnimation = {
  initial: {},
  animate: {},
  exit: { opacity: 0, transition: tween },
};

const ScreenView = ({
  view,
  index,
  isHidden,
}: {
  view: ViewInstance;
  index: number;
  isHidden: boolean;
}) => {
  const Component = VIEW_COMPONENTS[view.id];
  return (
    <motion.div
      className={styles.view}
      style={{ zIndex: index }}
      data-view-id={view.id}
      {...(index === 0 ? noAnimation : slideRight)}
    >
      <div className={styles.viewContent} data-hidden={isHidden} data-scroller>
        <Component />
      </div>
    </motion.div>
  );
};

const ViewStack = ({ views }: { views: ViewInstance[] }) => (
  <div className={styles.contentContainer}>
    <AnimatePresence>
      {views.map((view, index) => (
        <ScreenView
          key={`view-${view.id}`}
          view={view}
          index={index}
          isHidden={index < views.length - 1}
        />
      ))}
    </AnimatePresence>
  </div>
);

/**
 * Split views share the left menu panel (with a live preview on the right);
 * full-screen views cover the display.
 */
export const ViewManager = () => {
  const { viewStack, resetViews } = useViewContext();

  const splitViews = viewStack.filter((view) => VIEW_CONFIG[view.id].split);
  const fullViews = viewStack.filter((view) => !VIEW_CONFIG[view.id].split);

  const topView = viewStack[viewStack.length - 1];
  const disableLongPress = VIEW_CONFIG[topView.id].disableLongPress;

  useWindowEvent("menulongpress", () => {
    if (!disableLongPress) resetViews();
  });

  return (
    <div className={styles.viewManager}>
      <div className={styles.splitContainer} data-stack-type="splitscreen">
        <div className={styles.leftPanel} data-hidden={fullViews.length > 0}>
          <Header />
          <ViewStack views={splitViews} />
        </div>
        <PreviewPanel isHidden={false} />
      </div>
      <div
        className={styles.fullScreenContainer}
        data-stack-type="fullscreen"
        data-hidden={fullViews.length === 0}
      >
        <Header />
        <ViewStack views={fullViews} />
      </div>
      <div className={styles.mask} />
    </div>
  );
};
