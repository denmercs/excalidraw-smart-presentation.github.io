import {
  getNonDeletedElements,
  getFrameChildren,
  newFrameElement,
  newElementWith,
  getBoundTextElement,
  duplicateElement,
  mutateElement,
  isFrameLikeElement,
  syncInvalidIndices,
} from "@excalidraw/element";
import { arrayToMap } from "@excalidraw/common";
import type { Mutable } from "@excalidraw/common/utility-types";
import { register } from "./register";
import type { AppClassProperties, AppState, UIAppState } from "../types";
import type { ExcalidrawElement } from "@excalidraw/element/types";
import { CaptureUpdateAction } from "@excalidraw/element";
import type {
  ExcalidrawFrameLikeElement,
  GroupId,
} from "@excalidraw/element/types";

const FRAME_GAP = 40;
const MIN_FRAME_WIDTH = 400;
const MIN_FRAME_HEIGHT = 300;

const OVERVIEW_FRAME_NAME = "Start";

export const isSingleFrameSelected = (
  appState: UIAppState,
  app: AppClassProperties,
) => {
  const selected = app.scene.getSelectedElements(appState);
  return selected.length === 1 && isFrameLikeElement(selected[0]);
};

/** Numeric reveal order for progressive reveal (lower = earlier). Missing => sort after by index. */
const getRevealOrder = (el: ExcalidrawElement): number => {
  const v = (el as { customData?: Record<string, unknown> }).customData
    ?.revealOrder;
  return typeof v === "number" && Number.isFinite(v) ? v : Infinity;
};

/** Root elements in frame: not bound text (text with containerId). Ordered by customData.revealOrder (asc), then by index. */
export const getOrderedRootElementsInFrame = (
  allElements: readonly ExcalidrawElement[],
  frameId: string,
  elementsMap: Map<string, ExcalidrawElement>,
): ExcalidrawElement[] => {
  const children = getFrameChildren(allElements, frameId);
  const roots = children.filter(
    (el) => !(el.type === "text" && "containerId" in el && el.containerId),
  );
  roots.sort((a, b) => {
    const orderA = getRevealOrder(a);
    const orderB = getRevealOrder(b);
    if (orderA !== orderB) return orderA - orderB;
    return (a.index ?? "").localeCompare(b.index ?? "", "en");
  });
  return roots;
};

/**
 * One progressive-reveal step. An Excalidraw group (Ctrl/Cmd+G) is a single
 * unit so its members appear together; ungrouped shapes are one unit each.
 */
export type RevealUnit = {
  /** Outermost group id, or the single element's id if ungrouped. */
  id: string;
  isGroup: boolean;
  elements: ExcalidrawElement[];
};

const getOutermostGroupId = (el: ExcalidrawElement): string | null =>
  el.groupIds.length > 0 ? el.groupIds[el.groupIds.length - 1] : null;

/**
 * Collapse frame children into reveal steps. Grouped shapes share one step,
 * ordered by the first member's revealOrder / index.
 */
export const getOrderedRevealUnitsInFrame = (
  allElements: readonly ExcalidrawElement[],
  frameId: string,
  elementsMap: Map<string, ExcalidrawElement>,
): RevealUnit[] => {
  const roots = getOrderedRootElementsInFrame(
    allElements,
    frameId,
    elementsMap,
  );
  const units: RevealUnit[] = [];
  const groupToUnit = new Map<string, RevealUnit>();

  for (const el of roots) {
    const groupId = getOutermostGroupId(el);
    if (!groupId) {
      units.push({ id: el.id, isGroup: false, elements: [el] });
      continue;
    }
    const existing = groupToUnit.get(groupId);
    if (existing) {
      existing.elements.push(el);
    } else {
      const unit: RevealUnit = {
        id: groupId,
        isGroup: true,
        elements: [el],
      };
      groupToUnit.set(groupId, unit);
      units.push(unit);
    }
  }

  // A leftover 1-member group is treated as a normal item.
  return units.map((unit) =>
    unit.elements.length < 2
      ? { id: unit.elements[0].id, isGroup: false, elements: unit.elements }
      : unit,
  );
};

const resolveRevealUnitsFromOrder = (
  units: RevealUnit[],
  orderedIds: string[] | null,
): RevealUnit[] => {
  if (orderedIds === null) {
    return units;
  }
  const used = new Set<string>();
  const resolved: RevealUnit[] = [];
  for (const id of orderedIds) {
    const unit =
      units.find((u) => u.id === id) ??
      units.find((u) => u.elements.some((el) => el.id === id));
    if (unit && !used.has(unit.id)) {
      used.add(unit.id);
      resolved.push(unit);
    }
  }
  for (const unit of units) {
    if (!used.has(unit.id)) {
      resolved.push(unit);
    }
  }
  return resolved;
};

const cloneRootIntoFrame = (
  source: ExcalidrawElement,
  sourceFrame: ExcalidrawFrameLikeElement,
  targetFrame: ExcalidrawFrameLikeElement,
  appState: Pick<AppState, "editingGroupId">,
  groupIdMap: Map<GroupId, GroupId>,
  elementsMap: Map<string, ExcalidrawElement>,
): ExcalidrawElement[] => {
  const cloned: ExcalidrawElement[] = [];
  const dup = duplicateElement(
    appState.editingGroupId ?? null,
    groupIdMap,
    source,
    true,
  ) as Mutable<ExcalidrawElement>;
  dup.frameId = targetFrame.id;
  dup.x = targetFrame.x + (source.x - sourceFrame.x);
  dup.y = targetFrame.y + (source.y - sourceFrame.y);
  dup.customData = {
    ...dup.customData,
    name: source.customData?.name ?? source.id,
  };
  cloned.push(dup);

  const bound = getBoundTextElement(source, elementsMap);
  if (bound) {
    const dupBound = duplicateElement(
      appState.editingGroupId ?? null,
      groupIdMap,
      bound,
      true,
    ) as Mutable<ExcalidrawElement>;
    dupBound.frameId = targetFrame.id;
    dupBound.x = targetFrame.x + (bound.x - sourceFrame.x);
    dupBound.y = targetFrame.y + (bound.y - sourceFrame.y);
    dupBound.customData = {
      ...dupBound.customData,
      name: bound.customData?.name ?? bound.id,
    };
    if ("containerId" in dupBound) {
      dupBound.containerId = dup.id;
    }
    if ("boundElements" in dup && dup.boundElements) {
      (dup as Mutable<typeof dup>).boundElements = [
        { id: dupBound.id, type: "text" as const },
      ];
    }
    cloned.push(dupBound);
  }

  return cloned;
};

/** Find the single frame named "Start" (case-insensitive, trimmed). Returns null if not exactly one. */
export const getOverviewFrame = (
  elements: readonly ExcalidrawElement[],
): ExcalidrawFrameLikeElement | null => {
  const frames = getNonDeletedElements(elements).filter(
    (e): e is ExcalidrawFrameLikeElement => isFrameLikeElement(e),
  );
  const overviews = frames.filter(
    (f) => f.name?.trim().toLowerCase() === OVERVIEW_FRAME_NAME.toLowerCase(),
  );
  return overviews.length === 1 ? overviews[0] : null;
};

type FrameWithCustom = ExcalidrawFrameLikeElement & {
  customData?: { generatedFromOverviewFrameId?: string };
};

/**
 * Returns all frames in the same progressive-reveal sequence as the given frame.
 * Sequence = same generatedFromOverviewFrameId, or the overview frame plus all frames generated from it.
 * Used to allow "Delete column" only when the sequence has more than one frame (keep the last one).
 */
export const getProgressiveRevealSequenceFrames = (
  elements: readonly ExcalidrawElement[],
  frame: ExcalidrawFrameLikeElement,
): ExcalidrawFrameLikeElement[] => {
  const allFrames = getNonDeletedElements(elements).filter(
    (e): e is ExcalidrawFrameLikeElement => isFrameLikeElement(e),
  );
  const key =
    (frame as FrameWithCustom).customData?.generatedFromOverviewFrameId ??
    frame.id;
  return allFrames.filter((f) => {
    const fKey = (f as FrameWithCustom).customData?.generatedFromOverviewFrameId ?? f.id;
    return fKey === key;
  });
};

export type GenerateProgressiveRevealOptions = {
  /** When true, set customData.generatedFromOverviewFrameId on each generated frame */
  markGenerated?: boolean;
};

/**
 * Replaces the selected diagram frame with N slide frames:
 * - Removes the original frame and all its children from the scene.
 * - Creates N new frames: frame 1 has unit 1, frame 2 has units 1+2, ..., frame N has all N.
 *   A unit is either one ungrouped element or one Excalidraw group (shown together).
 * - Duplicated elements share stable customData.name for presentation animation.
 * Returns the full new elements array (rest of scene + new frames and their content).
 */
export function generateProgressiveRevealFromFrame(
  elements: readonly ExcalidrawElement[],
  diagramFrame: ExcalidrawFrameLikeElement,
  appState: Pick<AppState, "editingGroupId">,
  options: GenerateProgressiveRevealOptions = {},
): ExcalidrawElement[] {
  const { markGenerated = false } = options;
  const allElements = getNonDeletedElements(elements);
  const elementsMap = arrayToMap(allElements);
  const units = getOrderedRevealUnitsInFrame(
    allElements,
    diagramFrame.id,
    elementsMap,
  );
  const n = units.length;
  if (n === 0) {
    return Array.isArray(elements) ? [...elements] : Array.from(elements);
  }

  const idsToRemove = new Set<string>();
  idsToRemove.add(diagramFrame.id);
  for (const unit of units) {
    for (const el of unit.elements) {
      idsToRemove.add(el.id);
      const bound = getBoundTextElement(el, elementsMap);
      if (bound) idsToRemove.add(bound.id);
    }
  }

  const otherElements = (
    Array.isArray(elements) ? elements : Array.from(elements.values())
  ).filter((e) => !idsToRemove.has(e.id));

  const frameWidth = Math.max(
    MIN_FRAME_WIDTH,
    diagramFrame.width || MIN_FRAME_WIDTH,
  );
  const frameHeight = Math.max(
    MIN_FRAME_HEIGHT,
    diagramFrame.height || MIN_FRAME_HEIGHT,
  );

  const newElements: ExcalidrawElement[] = [];

  for (let i = 1; i <= n; i++) {
    const frameName = i === 1 ? OVERVIEW_FRAME_NAME : `Frame ${i - 1}`;
    const newFrame = newFrameElement({
      x: diagramFrame.x,
      y: diagramFrame.y + (i - 1) * (frameHeight + FRAME_GAP),
      width: frameWidth,
      height: frameHeight,
      name: frameName,
    });
    if (markGenerated) {
      (newFrame as Mutable<typeof newFrame>).customData = {
        ...newFrame.customData,
        generatedFromOverviewFrameId: diagramFrame.id,
      };
    }
    newElements.push(newFrame);

    // Fresh group ids per slide so copies on different frames stay independent.
    const groupIdMap = new Map<GroupId, GroupId>();
    for (let j = 0; j < i; j++) {
      for (const source of units[j].elements) {
        newElements.push(
          ...cloneRootIntoFrame(
            source,
            diagramFrame,
            newFrame,
            appState,
            groupIdMap,
            elementsMap,
          ),
        );
      }
    }
  }

  return syncInvalidIndices([...otherElements, ...newElements]);
}

export const actionCreateProgressiveReveal = register({
  name: "createProgressiveReveal",
  label: "labels.createProgressiveReveal",
  trackEvent: { category: "element" },
  predicate: (elements, appState, _, app) => {
    if (!isSingleFrameSelected(appState, app)) return false;
    const frame = app.scene.getSelectedElements(appState)[0];
    if (!isFrameLikeElement(frame)) return false;
    const all = getNonDeletedElements(elements);
    const elementsMap = arrayToMap(all);
    const units = getOrderedRevealUnitsInFrame(all, frame.id, elementsMap);
    return units.length >= 1;
  },
  perform: (elements, appState, _, app) => {
    const selected = app.scene.getSelectedElements(appState);
    const frame = selected[0];
    if (!frame || !isFrameLikeElement(frame)) {
      app.setToast?.({
        message: "Select a single frame with elements to create a progressive reveal.",
        duration: 4000,
      });
      return {
        elements,
        appState,
        captureUpdate: CaptureUpdateAction.EVENTUALLY,
      };
    }

    const all = getNonDeletedElements(elements);
    const elementsMap = arrayToMap(all);
    const units = getOrderedRevealUnitsInFrame(all, frame.id, elementsMap);
    if (units.length === 0) {
      app.setToast?.({
        message:
          "Add at least one shape or element inside the frame (not only text labels).",
        duration: 4000,
      });
      return {
        elements,
        appState,
        captureUpdate: CaptureUpdateAction.EVENTUALLY,
      };
    }

    const nextElements = generateProgressiveRevealFromFrame(
      elements,
      frame,
      appState as AppState,
      { markGenerated: true },
    );

    const firstNewFrameId = (() => {
      const all = getNonDeletedElements(nextElements);
      const frames = all.filter(
        (e): e is ExcalidrawFrameLikeElement => isFrameLikeElement(e),
      );
      const byY = frames.slice().sort((a, b) => a.y - b.y);
      return byY[0]?.id;
    })();

    app.setToast?.({
      message: `Created ${units.length} slide${units.length === 1 ? "" : "s"}.`,
      duration: 2500,
    });

    return {
      elements: nextElements,
      appState: {
        ...appState,
        selectedElementIds: firstNewFrameId
          ? { [firstNewFrameId]: true }
          : appState.selectedElementIds,
      },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    };
  },
});

/** Assign reveal order 0, 1, 2, ... to reveal units in the selected frame (grouped shapes share one order). */
export const actionSetRevealOrder = register({
  name: "setRevealOrder",
  label: "labels.setRevealOrder",
  trackEvent: { category: "element" },
  predicate: (elements, appState, _, app) => {
    if (!isSingleFrameSelected(appState, app)) return false;
    const frame = app.scene.getSelectedElements(appState)[0];
    if (!isFrameLikeElement(frame)) return false;
    const all = getNonDeletedElements(elements);
    const elementsMap = arrayToMap(all);
    const units = getOrderedRevealUnitsInFrame(all, frame.id, elementsMap);
    return units.length >= 1;
  },
  perform: (elements, appState, value, app) => {
    const frame = app.scene.getSelectedElements(appState)[0];
    if (!frame || !isFrameLikeElement(frame)) {
      return {
        elements,
        appState,
        captureUpdate: CaptureUpdateAction.EVENTUALLY,
      };
    }
    const all = getNonDeletedElements(elements);
    const elementsMap = arrayToMap(all);
    const defaultUnits = getOrderedRevealUnitsInFrame(
      all,
      frame.id,
      elementsMap,
    );
    // Optional custom order: value is array of unit/element ids, or { order: string[], silent?: boolean }
    const valueOrder =
      Array.isArray(value) && value.length > 0 && typeof value[0] === "string"
        ? (value as string[])
        : typeof value === "object" &&
            value !== null &&
            Array.isArray((value as { order?: string[] }).order)
        ? (value as { order: string[] }).order
        : null;
    const silent =
      typeof value === "object" &&
      value !== null &&
      (value as { silent?: boolean }).silent === true;
    const orderedUnits = resolveRevealUnitsFromOrder(defaultUnits, valueOrder);

    const unitIndexByElementId = new Map<string, number>();
    orderedUnits.forEach((unit, i) => {
      for (const el of unit.elements) {
        unitIndexByElementId.set(el.id, i);
      }
    });
    const elementsArray = Array.isArray(elements)
      ? elements
      : Array.from(elements);
    const nextElementsMap = arrayToMap(
      getNonDeletedElements(elementsArray) as ExcalidrawElement[],
    );
    const nextElements = elementsArray.map((el) => {
      const i = unitIndexByElementId.get(el.id);
      if (i === undefined) {
        return el;
      }
      const customData = (
        el as ExcalidrawElement & { customData?: Record<string, unknown> }
      ).customData;
      return mutateElement(el as Mutable<ExcalidrawElement>, nextElementsMap, {
        customData: { ...customData, revealOrder: i },
      });
    });

    if (!silent) {
      app.setToast?.({
        message: `Reveal order set for ${orderedUnits.length} step${
          orderedUnits.length === 1 ? "" : "s"
        }.`,
        duration: 2500,
      });
    }

    return {
      elements: nextElements,
      appState,
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    };
  },
});

/**
 * Delete all frames in the selected frame's progressive-reveal sequence except the last one.
 * Also deletes all elements inside the removed frames (does not ungroup).
 */
export const actionDeleteProgressiveRevealColumn = register({
  name: "deleteProgressiveRevealColumn",
  label: "stats.revealOrderDeleteColumn",
  trackEvent: { category: "element", action: "deleteProgressiveRevealColumn" },
  predicate: (elements, appState, _, app) => {
    if (!isSingleFrameSelected(appState, app)) return false;
    const frame = app.scene.getSelectedElements(appState)[0];
    if (!isFrameLikeElement(frame)) return false;
    const sequence = getProgressiveRevealSequenceFrames(
      getNonDeletedElements(elements),
      frame,
    );
    return sequence.length > 1;
  },
  perform: (elements, appState, _value, app) => {
    const frame = app.scene.getSelectedElements(appState)[0];
    if (!frame || !isFrameLikeElement(frame)) {
      return { elements, appState, captureUpdate: CaptureUpdateAction.EVENTUALLY };
    }
    const all = getNonDeletedElements(elements);
    const sequence = getProgressiveRevealSequenceFrames(all, frame);
    if (sequence.length <= 1) {
      return { elements, appState, captureUpdate: CaptureUpdateAction.EVENTUALLY };
    }
    // Sort by x then y so "last" is well-defined (rightmost/bottom).
    const sorted = [...sequence].sort((a, b) =>
      a.x !== b.x ? a.x - b.x : a.y - b.y,
    );
    const framesToDelete = sorted.slice(0, -1);
    const lastFrame = sorted[sorted.length - 1];

    const idsToDelete = new Set<string>();
    for (const f of framesToDelete) {
      idsToDelete.add(f.id);
      const children = getFrameChildren(all, f.id);
      for (const el of children) {
        idsToDelete.add(el.id);
      }
    }

    const elementsArray =
      Array.isArray(elements) ? elements : Array.from(elements);
    const nextElements = elementsArray.map((el) =>
      idsToDelete.has(el.id) ? newElementWith(el, { isDeleted: true }) : el,
    );

    app.setToast?.({
      message: `Removed ${framesToDelete.length} frame${framesToDelete.length === 1 ? "" : "s"}.`,
      duration: 2500,
    });

    return {
      elements: nextElements,
      appState: {
        ...appState,
        selectedElementIds: lastFrame ? { [lastFrame.id]: true } : {},
      },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    };
  },
});
