import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Excalidraw } from "@excalidraw/excalidraw";
import {
  animate,
  settleTransition,
} from "excalidraw-app/presentation/animation";
import { EVENT, KEYS, supportsResizeObserver } from "@excalidraw/common";
import { isInitializedImageElement } from "@excalidraw/element/typeChecks";

import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
  NormalizedZoomValue,
} from "@excalidraw/excalidraw/types";
import type {
  ExcalidrawElement,
  ExcalidrawFrameElement,
  FileId,
} from "@excalidraw/element/types";

import { LocalData } from "../data/LocalData";
import { updateStaleImageStatuses } from "../data/FileManager";

import { SlideSwitcher } from "./SlideSwitcher";

import "./Presentation.scss";

const RE_PRESENTATION_LINK = /^#presentation=(\d+)$/;

/** Must match the column count of `.presentation-switcher-grid`. */
const SWITCHER_COLUMNS = 4;
/** How long a partially typed slide number stays pending before it's discarded. */
const PENDING_JUMP_TIMEOUT_MS = 3_000;

export const isPresentationLink = (link: string) => {
  const hash = new URL(link).hash;
  return RE_PRESENTATION_LINK.test(hash);
};

export const getFrameIndexFromLink = (link: string) => {
  const hash = new URL(link).hash;
  const match = hash.match(RE_PRESENTATION_LINK);
  if (!match) {
    throw new Error("Invalid match");
  }
  return parseInt(match[1]);
};

const getPositionedElementsForFrame = (
  frame: ExcalidrawFrameElement,
  allElements: ExcalidrawElement[],
) =>
  allElements
    .filter((e) => e.frameId === frame.id)
    .map((e) => ({
      ...e,
      x: e.x - frame.x,
      y: e.y - frame.y,
    }));

const getBaseKey = (e: ExcalidrawElement) =>
  `${e.type}-${e.customData?.name ?? e.id}`;

// Build map of element name to element, if element name is repeated within the same frame
// give it a _N suffix where N starts from 1
const buildElementMap = (
  frameElements: ExcalidrawElement[],
): Map<string, ExcalidrawElement> => {
  const map = new Map<string, ExcalidrawElement>();
  const counts = new Map<string, number>();
  for (const element of frameElements) {
    const baseKey = getBaseKey(element);
    let key = baseKey;
    // If this key is already used, append a suffix.
    if (map.has(key)) {
      const count = (counts.get(baseKey) ?? 0) + 1;
      counts.set(baseKey, count);
      key = `${baseKey}-${count}`;
    } else {
      counts.set(baseKey, 0);
    }
    map.set(key, element);
  }
  return map;
};

/**
 * State paired with a ref holding the same value, so that long-lived event
 * handlers can read the current value without being re-registered.
 */
const useRefState = <T,>(initial: T) => {
  const [value, setValue] = useState(initial);
  const ref = useRef(value);
  const set = useCallback((next: T) => {
    ref.current = next;
    setValue(next);
  }, []);
  return [value, set, ref] as const;
};

export function PresentationScene(props: {
  elements: ExcalidrawElement[];
  appState: Readonly<AppState>;
  frames: ExcalidrawFrameElement[];
  initialFrameIndex?: number;
}) {
  const { appState, elements, frames, initialFrameIndex = 0 } = props;
  const [loadedInitialFrame, setLoadedInitialFrame] = useState(false);
  const [frameIndex, setFrameIndex, frameIndexRef] =
    useRefState(initialFrameIndex);

  const [excalidrawAPI, setExcalidrawAPI] =
    useState<ExcalidrawImperativeAPI | null>(null);

  const showFrame = useCallback(
    (from: number, to: number, animated: boolean) => {
      const fromFrame = frames[from];
      const toFrame = frames[to];
      if (!excalidrawAPI || !fromFrame || !toFrame) {
        return;
      }
      animate(
        excalidrawAPI,
        buildElementMap(getPositionedElementsForFrame(fromFrame, elements)),
        buildElementMap(getPositionedElementsForFrame(toFrame, elements)),
        { duration: animated ? undefined : 0 },
      );
    },
    [elements, excalidrawAPI, frames],
  );

  /**
   * Navigation never waits on the running transition: an in-flight animation is
   * superseded, so a stalled one can't swallow input.
   */
  const goToFrame = useCallback(
    (target: number, { animated = true }: { animated?: boolean } = {}) => {
      if (!Number.isFinite(target) || frames.length === 0) {
        return;
      }
      const to = Math.max(0, Math.min(frames.length - 1, target));
      const from = frameIndexRef.current;
      if (to === from) {
        return;
      }
      setFrameIndex(to);
      showFrame(from, to, animated);
    },
    [frameIndexRef, frames.length, setFrameIndex, showFrame],
  );

  // Render initial frame and initial state
  useEffect(() => {
    if (loadedInitialFrame || !excalidrawAPI) {
      return;
    }
    // Disable rAF throttle since we handle our own rAF
    window.EXCALIDRAW_THROTTLE_RENDER = false;
    showFrame(initialFrameIndex, initialFrameIndex, false);
    setTimeout(
      () =>
        excalidrawAPI.updateScene({
          appState: {
            theme: appState.theme,
            viewBackgroundColor: appState.viewBackgroundColor,
          },
        }),
      0,
    );
    setLoadedInitialFrame(true);
  }, [
    appState,
    excalidrawAPI,
    initialFrameIndex,
    loadedInitialFrame,
    showFrame,
  ]);

  // Load files (e.g, images) on elements change
  useEffect(() => {
    if (!excalidrawAPI) {
      return;
    }
    const fileIds =
      elements.reduce((acc, element) => {
        if (isInitializedImageElement(element)) {
          return acc.concat(element.fileId);
        }
        return acc;
      }, [] as FileId[]) || [];
    LocalData.fileStorage
      .getFiles(fileIds)
      .then(({ loadedFiles, erroredFiles }) => {
        if (loadedFiles.length) {
          excalidrawAPI.addFiles(loadedFiles);
        }
        updateStaleImageStatuses({
          excalidrawAPI,
          erroredFiles,
          elements,
        });
      });
  }, [elements, excalidrawAPI]);

  // Presentation div observer to know by how much we need to zoom in
  const presentationSceneDiv = useRef<HTMLDivElement>(null);
  const [presentationWidth, setPresentationWidth] = useState(1);
  const [presentationHeight, setPresentationHeight] = useState(1);
  // We want the height, the width, or both to exactly fit the screen
  const scale = Math.min(
    presentationWidth / frames[frameIndex].width,
    presentationHeight / frames[frameIndex].height,
  );

  useEffect(() => {
    let resizeObserver: ResizeObserver | null = null;
    if (supportsResizeObserver && presentationSceneDiv.current) {
      resizeObserver = new ResizeObserver(() => {
        if (presentationSceneDiv.current) {
          const { width, height } =
            presentationSceneDiv.current.getBoundingClientRect();
          setPresentationWidth(width);
          setPresentationHeight(height);
        }
      });
      resizeObserver.observe(presentationSceneDiv.current);
    }
    return () => {
      resizeObserver?.disconnect();
    };
  }, []);

  // Update zoom whenever scale changes
  useEffect(() => {
    if (!excalidrawAPI) {
      return;
    }
    setTimeout(
      () =>
        excalidrawAPI.updateScene({
          appState: { zoom: { value: scale as NormalizedZoomValue } },
        }),
      0,
    );
  }, [excalidrawAPI, scale]);

  const nextSlide = useCallback(
    () => goToFrame(frameIndexRef.current + 1),
    [frameIndexRef, goToFrame],
  );

  const prevSlide = useCallback(
    () => goToFrame(frameIndexRef.current - 1),
    [frameIndexRef, goToFrame],
  );

  // rAF is paused while the tab is hidden or occluded, which is exactly what
  // happens when the presenter switches windows mid-transition. Land on the
  // target slide rather than resuming a stale interpolation.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        settleTransition();
      }
    };
    document.addEventListener(EVENT.VISIBILITY_CHANGE, handleVisibilityChange);
    return () => {
      document.removeEventListener(
        EVENT.VISIBILITY_CHANGE,
        handleVisibilityChange,
      );
    };
  }, []);

  // Keep the URL in sync so the current slide can be reopened or shared, and
  // honour external hash changes as an immediate jump.
  useEffect(() => {
    const hash = `#presentation=${frameIndex}`;
    if (window.location.hash !== hash) {
      window.history.replaceState(null, "", hash);
    }
  }, [frameIndex]);

  useEffect(() => {
    const handleHashChange = () => {
      if (isPresentationLink(window.location.href)) {
        goToFrame(getFrameIndexFromLink(window.location.href), {
          animated: false,
        });
      }
    };
    window.addEventListener("hashchange", handleHashChange);
    return () => {
      window.removeEventListener("hashchange", handleHashChange);
    };
  }, [goToFrame]);

  const [switcherOpen, setSwitcherOpen, switcherOpenRef] = useRefState(false);
  const [switcherFiles, setSwitcherFiles] = useState<BinaryFiles>({});
  const [highlightedIndex, setHighlightedIndex, highlightedIndexRef] =
    useRefState(initialFrameIndex);
  const [pendingJump, setPendingJump, pendingJumpRef] = useRefState("");

  const openSwitcher = useCallback(() => {
    setHighlightedIndex(frameIndexRef.current);
    setSwitcherFiles(excalidrawAPI?.getFiles() ?? {});
    setSwitcherOpen(true);
  }, [
    excalidrawAPI,
    frameIndexRef,
    setHighlightedIndex,
    setSwitcherFiles,
    setSwitcherOpen,
  ]);

  const jumpToFrame = useCallback(
    (target: number) => {
      setPendingJump("");
      setSwitcherOpen(false);
      goToFrame(target, { animated: false });
    },
    [goToFrame, setPendingJump, setSwitcherOpen],
  );

  // Discard a half-typed slide number so the presenter never has to guess what
  // state the keyboard is in.
  useEffect(() => {
    if (!pendingJump) {
      return;
    }
    const handle = setTimeout(
      () => setPendingJump(""),
      PENDING_JUMP_TIMEOUT_MS,
    );
    return () => clearTimeout(handle);
  }, [pendingJump, setPendingJump]);

  // Event listeners
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // let browser/OS shortcuts (reload, fullscreen, tab switching) through
      if (e.ctrlKey || e.metaKey || e.altKey) {
        return;
      }
      e.stopPropagation();

      const isSwitcherOpen = switcherOpenRef.current;
      const typedJump = pendingJumpRef.current;

      if (/^[0-9]$/.test(e.key)) {
        setPendingJump((typedJump + e.key).slice(-4));
        return;
      }

      switch (e.key) {
        case KEYS.ESCAPE:
          setPendingJump("");
          setSwitcherOpen(false);
          return;
        case KEYS.BACKSPACE:
          setPendingJump(typedJump.slice(0, -1));
          return;
        case KEYS.ENTER:
          if (typedJump) {
            jumpToFrame(parseInt(typedJump, 10) - 1);
          } else if (isSwitcherOpen) {
            jumpToFrame(highlightedIndexRef.current);
          }
          return;
        case "Home":
          jumpToFrame(0);
          return;
        case "End":
          jumpToFrame(frames.length - 1);
          return;
        case KEYS.G:
        case "G":
          if (isSwitcherOpen) {
            setSwitcherOpen(false);
          } else {
            openSwitcher();
          }
          return;
      }

      if (isSwitcherOpen) {
        const step =
          (e.key === KEYS.ARROW_RIGHT && 1) ||
          (e.key === KEYS.ARROW_LEFT && -1) ||
          (e.key === KEYS.ARROW_DOWN && SWITCHER_COLUMNS) ||
          (e.key === KEYS.ARROW_UP && -SWITCHER_COLUMNS) ||
          0;
        if (step) {
          setHighlightedIndex(
            Math.max(
              0,
              Math.min(frames.length - 1, highlightedIndexRef.current + step),
            ),
          );
        }
        return;
      }

      switch (e.key) {
        case KEYS.ARROW_RIGHT:
        case KEYS.ARROW_DOWN:
        case KEYS.PAGE_DOWN:
        case KEYS.SPACE:
          nextSlide();
          return;
        case KEYS.ARROW_LEFT:
        case KEYS.ARROW_UP:
        case KEYS.PAGE_UP:
          prevSlide();
      }
    };

    const handlePointerDownOrWheel = (e: MouseEvent | WheelEvent) => {
      e.stopPropagation();
    };

    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("pointerdown", handlePointerDownOrWheel, true);
    document.addEventListener("wheel", handlePointerDownOrWheel, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener(
        "pointerdown",
        handlePointerDownOrWheel,
        true,
      );
      document.removeEventListener("wheel", handlePointerDownOrWheel, true);
    };
  }, [
    frames.length,
    highlightedIndexRef,
    jumpToFrame,
    nextSlide,
    openSwitcher,
    pendingJumpRef,
    prevSlide,
    setHighlightedIndex,
    setPendingJump,
    setSwitcherOpen,
    switcherOpenRef,
  ]);

  // Keyboard navigation relies on the document having focus, which can be lost
  // to browser chrome while the presenter is talking.
  useEffect(() => {
    presentationSceneDiv.current?.focus();
  }, []);

  const loadExcalidrawAPI = useCallback((api: ExcalidrawImperativeAPI) => {
    setExcalidrawAPI(api);
  }, []);

  // Render
  return (
    <div
      className="presentation-presentation"
      ref={presentationSceneDiv}
      tabIndex={-1}
      onPointerDown={() => presentationSceneDiv.current?.focus()}
    >
      {/* Used for navigating slides using the mouse */}
      <div className="presentation-overlays">
        <div className="presentation-overlay" onClick={prevSlide}></div>
        <div className="presentation-overlay" onClick={nextSlide}></div>
      </div>

      {/* We want the canvas to be in a div that has the exact same size as the scaled (zoomed in) frame */}
      {/* The rest is going to be black through the outer div */}
      <div
        style={{
          width: `${frames[frameIndex].width * scale}px`,
          height: `${frames[frameIndex].height * scale}px`,
        }}
      >
        <Excalidraw
          excalidrawAPI={loadExcalidrawAPI}
          viewModeEnabled
          presentationModeEnabled
        />
      </div>

      <button
        type="button"
        className="presentation-counter"
        title="Jump to slide (G)"
        onClick={openSwitcher}
      >
        {pendingJump ? (
          <>
            <span className="presentation-counter-pending">{pendingJump}</span>
            <span className="presentation-counter-hint">press enter</span>
          </>
        ) : (
          <span>
            {frameIndex + 1} / {frames.length}
          </span>
        )}
      </button>

      {switcherOpen && (
        <SlideSwitcher
          appState={appState}
          elements={elements}
          files={switcherFiles}
          frames={frames}
          currentIndex={frameIndex}
          highlightedIndex={highlightedIndex}
          onHighlight={setHighlightedIndex}
          onSelect={jumpToFrame}
          onClose={() => setSwitcherOpen(false)}
        />
      )}
    </div>
  );
}

export const ELEMENTS_CHANNEL_NAME = "excalidraw-elements";
export const NEED_DATA_MESSAGE = "NEED_DATA";

export function Presentation() {
  const [elements, setElements] = useState<ExcalidrawElement[]>([]);
  const [appState, setAppState] = useState<Readonly<AppState | null>>();
  useEffect(() => {
    const channel = new BroadcastChannel(ELEMENTS_CHANNEL_NAME);
    const messageHandler = (
      event: MessageEvent<
        { elements: ExcalidrawElement[]; appState: Readonly<AppState> } | string
      >,
    ) => {
      if (typeof event.data !== "string") {
        setAppState(event.data.appState);
        setElements(event.data.elements);
      }
    };
    channel.addEventListener("message", messageHandler);
    channel.postMessage(NEED_DATA_MESSAGE);
    return () => {
      channel.removeEventListener("message", messageHandler);
    };
  }, []);

  const frames = useMemo(() => {
    const all = elements.filter(
      (e): e is ExcalidrawFrameElement => e.type === "frame",
    );
    if (all.length === 0) {
      return all;
    }
    // Group frames by progressive-reveal sequence (same generatedFromOverviewFrameId).
    // Standalone frames (no id) are each their own one-frame sequence.
    type FrameWithCustom = ExcalidrawFrameElement & {
      customData?: { generatedFromOverviewFrameId?: string };
    };
    const bySequence = new Map<string, ExcalidrawFrameElement[]>();
    for (const f of all) {
      const key =
        (f as FrameWithCustom).customData?.generatedFromOverviewFrameId ?? f.id;
      const list = bySequence.get(key) ?? [];
      list.push(f);
      bySequence.set(key, list);
    }
    // Sort frames within each sequence by column (x) then row (y), so the
    // slideshow advances per reveal column (1, 2, 3, 4 left-to-right).
    // Sort sequences by leftmost x so multi-sequence order is stable.
    const sequences: ExcalidrawFrameElement[][] = [];
    for (const list of bySequence.values()) {
      list.sort((a, b) => (a.x !== b.x ? a.x - b.x : a.y - b.y));
      sequences.push(list);
    }
    sequences.sort((a, b) => (a[0]?.x ?? 0) - (b[0]?.x ?? 0));
    return sequences.flat();
  }, [elements]);
  if (frames.length === 0 || !appState) {
    return (
      <div>
        <h1>Blank presentation</h1>
        <p>
          Learn how to make a presentation{" "}
          <a href="https://github.com/excalidraw-smart-presentation/excalidraw-smart-presentation.github.io?tab=readme-ov-file#excalidraw-smart-presentation">
            here
          </a>
        </p>
      </div>
    );
  }
  const frameIndex = getFrameIndexFromLink(window.location.href);
  const initialFrameIndex =
    frameIndex < 0 || frameIndex >= frames.length ? 0 : frameIndex;
  return (
    <PresentationScene
      appState={appState}
      elements={elements}
      frames={frames}
      initialFrameIndex={initialFrameIndex}
    />
  );
}
