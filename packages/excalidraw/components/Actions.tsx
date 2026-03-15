import clsx from "clsx";
import { useState, useEffect, useRef } from "react";
import type { CSSProperties } from "react";

import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import {
  CLASSES,
  KEYS,
  capitalizeString,
  isTransparent
} from "@excalidraw/common";

import {
  shouldAllowVerticalAlign,
  suppportsHorizontalAlign
} from "@excalidraw/element";

import {
  getBoundTextElement,
  hasBoundTextElement,
  isElbowArrow,
  isFrameLikeElement,
  isImageElement,
  isLinearElement,
  isTextElement
} from "@excalidraw/element";

import { hasStrokeColor, toolIsArrow } from "@excalidraw/element";

import type {
  ExcalidrawElement,
  ExcalidrawElementType,
  ExcalidrawFrameLikeElement,
  NonDeletedElementsMap,
  NonDeletedSceneElementsMap
} from "@excalidraw/element/types";
import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";

import {
  getOrderedRootElementsInFrame,
  getProgressiveRevealSequenceFrames,
  actionSetRevealOrder
} from "../actions/actionProgressiveReveal";

import {
  actionDeleteProgressiveRevealColumn,
  actionToggleZenMode
} from "../actions";

import { alignActionsPredicate } from "../actions/actionAlign";
import { trackEvent } from "../analytics";
import { useTunnels } from "../context/tunnels";

import { t } from "../i18n";
import {
  canChangeRoundness,
  canHaveArrowheads,
  getTargetElements,
  hasBackground,
  hasStrokeStyle,
  hasStrokeWidth
} from "../scene";

import { SHAPES } from "./shapes";

import "./Actions.scss";

import {
  useDevice,
  useExcalidrawActionManager,
  useExcalidrawSetAppState
} from "./App";
import Stack from "./Stack";
import { ToolButton } from "./ToolButton";
import { Tooltip } from "./Tooltip";
import DropdownMenu from "./dropdownMenu/DropdownMenu";
import {
  EmbedIcon,
  extraToolsIcon,
  frameToolIcon,
  mermaidLogoIcon,
  laserPointerToolIcon,
  MagicIcon,
  LassoIcon,
  gripVerticalIcon,
  playerPlayIcon,
  CloseIcon,
  TrashIcon
} from "./icons";

import type {
  AppClassProperties,
  AppProps,
  AppState,
  UIAppState,
  Zoom
} from "../types";
import type { ActionManager } from "../actions/manager";

export const canChangeStrokeColor = (
  appState: UIAppState,
  targetElements: ExcalidrawElement[]
) => {
  let commonSelectedType: ExcalidrawElementType | null =
    targetElements[0]?.type || null;

  for (const element of targetElements) {
    if (element.type !== commonSelectedType) {
      commonSelectedType = null;
      break;
    }
  }

  return (
    (hasStrokeColor(appState.activeTool.type) &&
      commonSelectedType !== "image" &&
      commonSelectedType !== "frame" &&
      commonSelectedType !== "magicframe") ||
    targetElements.some((element) => hasStrokeColor(element.type))
  );
};

export const canChangeBackgroundColor = (
  appState: UIAppState,
  targetElements: ExcalidrawElement[]
) => {
  return (
    hasBackground(appState.activeTool.type) ||
    targetElements.some((element) => hasBackground(element.type))
  );
};

const MAX_LABEL_WORDS = 3;

const getElementContentPreview = (
  el: NonDeletedExcalidrawElement,
  elementsMap: Map<string, ExcalidrawElement> | undefined
): string | null => {
  let text: string | null = null;
  if (el.type === "text" && "text" in el) {
    text = (el as { text: string }).text;
  } else if (elementsMap) {
    const bound = getBoundTextElement(el, elementsMap);
    if (bound && "text" in bound) {
      text = (bound as { text: string }).text;
    }
  }
  if (text == null || !String(text).trim()) {
    return null;
  }
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return null;
  }
  const firstThree = words.slice(0, MAX_LABEL_WORDS).join(" ");
  return words.length > MAX_LABEL_WORDS ? `${firstThree}…` : firstThree;
};

const getRevealOrderLabel = (
  el: NonDeletedExcalidrawElement,
  index: number,
  elementsMap: Map<string, ExcalidrawElement> | undefined
): string => {
  const contentPreview = getElementContentPreview(el, elementsMap);
  if (contentPreview) {
    return contentPreview;
  }
  const name = (
    el as NonDeletedExcalidrawElement & {
      customData?: { name?: string };
    }
  ).customData?.name;
  if (name != null && String(name).trim()) {
    return String(name).trim();
  }
  return `${t(`element.${el.type}`)} ${index + 1}`;
};

type SortableRevealOrderItemProps = {
  el: NonDeletedExcalidrawElement;
  index: number;
  elementsMap: Map<string, ExcalidrawElement> | undefined;
  highlightedId: string | null;
  editingId: string | null;
  app: AppClassProperties | undefined;
  onMouseEnter: (el: NonDeletedExcalidrawElement) => void;
  onMouseLeave: () => void;
  setEditingId: (id: string | null) => void;
};

const SortableRevealOrderItem = ({
  el,
  index,
  elementsMap,
  highlightedId,
  editingId,
  app,
  onMouseEnter,
  onMouseLeave,
  setEditingId
}: SortableRevealOrderItemProps) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: el.id });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={clsx("selected-shape-actions__reveal-order-item", {
        "selected-shape-actions__reveal-order-item--highlighted":
          highlightedId === el.id,
        "selected-shape-actions__reveal-order-item--dragging": isDragging
      })}
      onMouseEnter={() => onMouseEnter(el)}
      onMouseLeave={onMouseLeave}
    >
      <button
        type="button"
        className="selected-shape-actions__reveal-order-drag-handle"
        aria-label={t("stats.revealOrder")}
        {...attributes}
        {...listeners}
      >
        {gripVerticalIcon}
      </button>
      {editingId === el.id && app ? (
        <input
          type="text"
          className="selected-shape-actions__reveal-order-input"
          defaultValue={getRevealOrderLabel(el, index, elementsMap)}
          autoFocus
          onBlur={(e) => {
            const value = e.currentTarget.value.trim();
            app.scene.mutateElement(el, {
              customData: {
                ...(el as NonDeletedExcalidrawElement & {
                  customData?: Record<string, unknown>;
                }).customData,
                name: value || undefined
              }
            });
            setEditingId(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.currentTarget.blur();
            }
            if (e.key === "Escape") {
              setEditingId(null);
            }
          }}
        />
      ) : (
        <button
          type="button"
          className="selected-shape-actions__reveal-order-label-btn"
          onClick={() => app && setEditingId(el.id)}
          title={t("stats.revealOrderRenameHint")}
        >
          {getRevealOrderLabel(el, index, elementsMap)}
        </button>
      )}
    </li>
  );
};

const RevealOrderBlock = ({
  roots,
  app,
  elementsMap,
  setAppState: setAppStateProp
}: {
  roots: readonly NonDeletedExcalidrawElement[];
  app?: AppClassProperties;
  elementsMap?: Map<string, ExcalidrawElement>;
  /** When provided (e.g. from LayerUI), avoids relying on context which can be uninitialized in isolated/subtrees */
  setAppState?: React.Component<any, AppState>["setState"];
}) => {
  const actionManager = useExcalidrawActionManager();
  const setAppStateFromContext = useExcalidrawSetAppState();
  const setAppState = setAppStateProp ?? setAppStateFromContext;
  const [order, setOrder] = useState<string[]>(() => roots.map((r) => r.id));
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [previewStep, setPreviewStep] = useState<number>(-1);
  const prevRootIdSetRef = useRef<string>("");

  // Sync order from roots only when the set of elements in the frame changes
  // (not on every re-render), so hover highlight doesn’t reset user reordering.
  useEffect(() => {
    const rootIdSet = roots
      .map((r) => r.id)
      .sort()
      .join(",");
    if (prevRootIdSetRef.current !== rootIdSet) {
      prevRootIdSetRef.current = rootIdSet;
      setOrder(roots.map((r) => r.id));
    }
  }, [roots]);

  const orderMap = new Map(order.map((id, i) => [id, i]));
  const sortedRoots = [...roots].sort(
    (a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0)
  );
  const sortedRootsRef = useRef(sortedRoots);
  sortedRootsRef.current = sortedRoots;

  // Preview mode: highlight on canvas the elements revealed up to current step.
  // Use ref for sortedRoots so we don't retrigger on every render (sortedRoots is a new array each time).
  useEffect(() => {
    if (previewStep < 0) {
      return;
    }
    const toHighlight = sortedRootsRef.current.slice(0, previewStep + 1);
    setAppState((prev) => ({ ...prev, elementsToHighlight: toHighlight }));
  }, [previewStep, setAppState]);

  // Clear canvas highlight when this block unmounts or preview exits.
  useEffect(() => {
    return () => {
      setAppState((prev) => ({ ...prev, elementsToHighlight: null }));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cleanup on unmount only
  }, []);

  const handleMouseEnter = (el: NonDeletedExcalidrawElement) => {
    setHighlightedId(el.id);
    if (previewStep < 0) {
      setAppState((prev) => ({ ...prev, elementsToHighlight: [el] }));
    }
  };

  const handleMouseLeave = () => {
    setHighlightedId(null);
    if (previewStep < 0) {
      setAppState((prev) => ({ ...prev, elementsToHighlight: null }));
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 }
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over == null || active.id === over.id) {
      return;
    }
    const oldIndex = order.indexOf(active.id as string);
    const newIndex = order.indexOf(over.id as string);
    if (oldIndex === -1 || newIndex === -1) {
      return;
    }
    const newOrder = arrayMove(order, oldIndex, newIndex);
    setOrder(newOrder);
    actionManager.executeAction(actionSetRevealOrder, "api", {
      order: newOrder,
      silent: true
    });
  };

  const startPreview = () => {
    setPreviewStep(0);
  };
  const exitPreview = () => {
    setPreviewStep(-1);
    setAppState((prev) => ({ ...prev, elementsToHighlight: null }));
  };
  const previewPrev = () => {
    setPreviewStep((s) => (s <= 0 ? 0 : s - 1));
  };
  const previewNext = () => {
    setPreviewStep((s) =>
      s >= sortedRoots.length - 1 ? sortedRoots.length - 1 : s + 1
    );
  };
  const nextLabel =
    previewStep >= 0 && previewStep < sortedRoots.length - 1
      ? getRevealOrderLabel(
          sortedRoots[previewStep + 1],
          previewStep + 1,
          elementsMap
        )
      : null;

  return (
    <div className="selected-shape-actions__reveal-order">
      <p className="selected-shape-actions__reveal-order-hint">
        {t("stats.revealOrderHint")}
      </p>
      <div className="selected-shape-actions__reveal-order-preview">
        {previewStep < 0 ? (
          <button
            type="button"
            className="selected-shape-actions__reveal-order-preview-btn"
            onClick={startPreview}
            title={t("stats.revealOrderPreview")}
            aria-label={t("stats.revealOrderPreview")}
          >
            {playerPlayIcon}
            <span>{t("stats.revealOrderPreview")}</span>
          </button>
        ) : (
          <>
            <span className="selected-shape-actions__reveal-order-step">
              {t("stats.revealOrderStep", {
                current: previewStep + 1,
                total: sortedRoots.length
              })}
              {nextLabel != null && (
                <span className="selected-shape-actions__reveal-order-next">
                  {t("stats.revealOrderNextLabel")}: {nextLabel}
                </span>
              )}
            </span>
            <div className="selected-shape-actions__reveal-order-preview-actions">
              <button
                type="button"
                className="selected-shape-actions__reveal-order-preview-btn"
                onClick={previewPrev}
                disabled={previewStep === 0}
                title={t("stats.revealOrderPrev")}
                aria-label={t("stats.revealOrderPrev")}
              >
                ‹
              </button>
              <button
                type="button"
                className="selected-shape-actions__reveal-order-preview-btn"
                onClick={previewNext}
                disabled={previewStep === sortedRoots.length - 1}
                title={t("stats.revealOrderNext")}
                aria-label={t("stats.revealOrderNext")}
              >
                ›
              </button>
              <button
                type="button"
                className="selected-shape-actions__reveal-order-preview-btn selected-shape-actions__reveal-order-preview-done"
                onClick={exitPreview}
                title={t("stats.revealOrderPreviewDone")}
                aria-label={t("stats.revealOrderPreviewDone")}
              >
                {CloseIcon}
                <span>{t("stats.revealOrderPreviewDone")}</span>
              </button>
            </div>
          </>
        )}
      </div>
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <SortableContext
          items={order}
          strategy={verticalListSortingStrategy}
        >
          <ul className="selected-shape-actions__reveal-order-list">
            {sortedRoots.map((el, index) => (
              <SortableRevealOrderItem
                key={el.id}
                el={el}
                index={index}
                elementsMap={elementsMap}
                highlightedId={highlightedId}
                editingId={editingId}
                app={app}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
                setEditingId={setEditingId}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
    </div>
  );
};

export const SelectedShapeActions = ({
  appState,
  elementsMap,
  renderAction,
  app,
  setAppState: setAppStateProp
}: {
  appState: UIAppState;
  elementsMap: NonDeletedElementsMap | NonDeletedSceneElementsMap;
  renderAction: ActionManager["renderAction"];
  app: AppClassProperties;
  /** When provided (e.g. from LayerUI), passed to RevealOrderBlock to avoid context issues in isolated trees */
  setAppState?: React.Component<any, AppState>["setState"];
}) => {
  const actionManager = useExcalidrawActionManager();
  const targetElements = getTargetElements(elementsMap, appState);

  let isSingleElementBoundContainer = false;
  if (
    targetElements.length === 2 &&
    (hasBoundTextElement(targetElements[0]) ||
      hasBoundTextElement(targetElements[1]))
  ) {
    isSingleElementBoundContainer = true;
  }
  const isEditingTextOrNewElement = Boolean(
    appState.editingTextElement || appState.newElement
  );
  const device = useDevice();
  const isRTL = document.documentElement.getAttribute("dir") === "rtl";

  const showFillIcons =
    (hasBackground(appState.activeTool.type) &&
      !isTransparent(appState.currentItemBackgroundColor)) ||
    targetElements.some(
      (element) =>
        hasBackground(element.type) && !isTransparent(element.backgroundColor)
    );

  const showLinkIcon =
    targetElements.length === 1 || isSingleElementBoundContainer;

  const showLineEditorAction =
    !appState.editingLinearElement &&
    targetElements.length === 1 &&
    isLinearElement(targetElements[0]) &&
    !isElbowArrow(targetElements[0]);

  const showCropEditorAction =
    !appState.croppingElementId &&
    targetElements.length === 1 &&
    isImageElement(targetElements[0]);

  const showAlignActions =
    !isSingleElementBoundContainer && alignActionsPredicate(appState, app);

  const singleFrameSelected =
    targetElements.length === 1 && isFrameLikeElement(targetElements[0]);
  const revealOrderRoots = singleFrameSelected
    ? getOrderedRootElementsInFrame(
        app.scene.getNonDeletedElements(),
        targetElements[0].id,
        elementsMap
      )
    : [];
  const progressiveRevealSequenceFrames = singleFrameSelected
    ? getProgressiveRevealSequenceFrames(
        app.scene.getNonDeletedElements(),
        targetElements[0] as ExcalidrawFrameLikeElement
      )
    : [];
  const canDeleteProgressiveRevealColumn =
    progressiveRevealSequenceFrames.length > 1;

  return (
    <div className="selected-shape-actions">
      <div>
        {canChangeStrokeColor(appState, targetElements) &&
          renderAction("changeStrokeColor")}
      </div>
      {canChangeBackgroundColor(appState, targetElements) && (
        <div>{renderAction("changeBackgroundColor")}</div>
      )}
      {showFillIcons && renderAction("changeFillStyle")}

      {(hasStrokeWidth(appState.activeTool.type) ||
        targetElements.some((element) => hasStrokeWidth(element.type))) &&
        renderAction("changeStrokeWidth")}

      {(appState.activeTool.type === "freedraw" ||
        targetElements.some((element) => element.type === "freedraw")) &&
        renderAction("changeStrokeShape")}

      {(hasStrokeStyle(appState.activeTool.type) ||
        targetElements.some((element) => hasStrokeStyle(element.type))) && (
        <>
          {renderAction("changeStrokeStyle")}
          {renderAction("changeSloppiness")}
        </>
      )}

      {(canChangeRoundness(appState.activeTool.type) ||
        targetElements.some((element) => canChangeRoundness(element.type))) && (
        <>{renderAction("changeRoundness")}</>
      )}

      {(toolIsArrow(appState.activeTool.type) ||
        targetElements.some((element) => toolIsArrow(element.type))) && (
        <>{renderAction("changeArrowType")}</>
      )}

      {(appState.activeTool.type === "text" ||
        targetElements.some(isTextElement)) && (
        <>
          {renderAction("changeFontFamily")}
          {renderAction("changeFontSize")}
          {(appState.activeTool.type === "text" ||
            suppportsHorizontalAlign(targetElements, elementsMap)) &&
            renderAction("changeTextAlign")}
        </>
      )}

      {shouldAllowVerticalAlign(targetElements, elementsMap) &&
        renderAction("changeVerticalAlign")}
      {(canHaveArrowheads(appState.activeTool.type) ||
        targetElements.some((element) => canHaveArrowheads(element.type))) && (
        <>{renderAction("changeArrowhead")}</>
      )}

      {renderAction("changeOpacity")}

      <fieldset>
        <legend>{t("labels.layers")}</legend>
        <div className="buttonList">
          {renderAction("sendToBack")}
          {renderAction("sendBackward")}
          {renderAction("bringForward")}
          {renderAction("bringToFront")}
        </div>
      </fieldset>

      {showAlignActions && !isSingleElementBoundContainer && (
        <fieldset>
          <legend>{t("labels.align")}</legend>
          <div className="buttonList">
            {
              // swap this order for RTL so the button positions always match their action
              // (i.e. the leftmost button aligns left)
            }
            {isRTL ? (
              <>
                {renderAction("alignRight")}
                {renderAction("alignHorizontallyCentered")}
                {renderAction("alignLeft")}
              </>
            ) : (
              <>
                {renderAction("alignLeft")}
                {renderAction("alignHorizontallyCentered")}
                {renderAction("alignRight")}
              </>
            )}
            {targetElements.length > 2 &&
              renderAction("distributeHorizontally")}
            {/* breaks the row ˇˇ */}
            <div style={{ flexBasis: "100%", height: 0 }} />
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: ".5rem",
                marginTop: "-0.5rem"
              }}
            >
              {renderAction("alignTop")}
              {renderAction("alignVerticallyCentered")}
              {renderAction("alignBottom")}
              {targetElements.length > 2 &&
                renderAction("distributeVertically")}
            </div>
          </div>
        </fieldset>
      )}
      {!isEditingTextOrNewElement && targetElements.length > 0 && (
        <fieldset>
          <legend>{t("labels.actions")}</legend>
          <div className="buttonList">
            {!device.editor.isMobile && renderAction("duplicateSelection")}
            {!device.editor.isMobile && renderAction("deleteSelectedElements")}
            {renderAction("group")}
            {renderAction("ungroup")}
            {showLinkIcon && renderAction("hyperlink")}
            {showCropEditorAction && renderAction("cropEditor")}
            {showLineEditorAction && renderAction("toggleLinearEditor")}
          </div>
        </fieldset>
      )}
      {singleFrameSelected &&
        (revealOrderRoots.length > 0 || canDeleteProgressiveRevealColumn) && (
          <fieldset>
            <legend>{t("stats.revealOrder")}</legend>
            {revealOrderRoots.length > 0 && (
              <RevealOrderBlock
                roots={revealOrderRoots}
                app={app}
                elementsMap={elementsMap}
                setAppState={setAppStateProp}
              />
            )}
            {canDeleteProgressiveRevealColumn && (
              <div className="selected-shape-actions__reveal-order-delete-column">
                <button
                  type="button"
                  className="selected-shape-actions__reveal-order-preview-btn"
                  onClick={() =>
                    actionManager.executeAction(
                      actionDeleteProgressiveRevealColumn
                    )
                  }
                  title={t("stats.revealOrderDeleteColumn")}
                  aria-label={t("stats.revealOrderDeleteColumn")}
                >
                  {TrashIcon}
                  <span>{t("stats.revealOrderDeleteColumn")}</span>
                </button>
              </div>
            )}
          </fieldset>
        )}
    </div>
  );
};

export const ShapesSwitcher = ({
  activeTool,
  appState,
  app,
  UIOptions
}: {
  activeTool: UIAppState["activeTool"];
  appState: UIAppState;
  app: AppClassProperties;
  UIOptions: AppProps["UIOptions"];
}) => {
  const [isExtraToolsMenuOpen, setIsExtraToolsMenuOpen] = useState(false);

  const frameToolSelected = activeTool.type === "frame";
  const laserToolSelected = activeTool.type === "laser";
  const lassoToolSelected = activeTool.type === "lasso";

  const embeddableToolSelected = activeTool.type === "embeddable";

  const { TTDDialogTriggerTunnel } = useTunnels();

  return (
    <>
      {SHAPES.map(({ value, icon, key, numericKey, fillable }, index) => {
        if (
          UIOptions.tools?.[
            value as Extract<typeof value, keyof AppProps["UIOptions"]["tools"]>
          ] === false
        ) {
          return null;
        }

        const label = t(`toolBar.${value}`);
        const letter =
          key && capitalizeString(typeof key === "string" ? key : key[0]);
        const shortcut = letter
          ? `${letter} ${t("helpDialog.or")} ${numericKey}`
          : `${numericKey}`;

        return (
          <ToolButton
            className={clsx("Shape", { fillable })}
            key={value}
            type="radio"
            icon={icon}
            checked={activeTool.type === value}
            name="editor-current-shape"
            title={`${capitalizeString(label)} — ${shortcut}`}
            keyBindingLabel={numericKey || letter}
            aria-label={capitalizeString(label)}
            aria-keyshortcuts={shortcut}
            data-testid={`toolbar-${value}`}
            onPointerDown={({ pointerType }) => {
              if (!appState.penDetected && pointerType === "pen") {
                app.togglePenMode(true);
              }

              if (value === "selection") {
                if (appState.activeTool.type === "selection") {
                  app.setActiveTool({ type: "lasso" });
                } else {
                  app.setActiveTool({ type: "selection" });
                }
              }
            }}
            onChange={({ pointerType }) => {
              if (appState.activeTool.type !== value) {
                trackEvent("toolbar", value, "ui");
              }
              if (value === "image") {
                app.setActiveTool({
                  type: value
                });
              } else {
                app.setActiveTool({ type: value });
              }
            }}
          />
        );
      })}
      <div className="App-toolbar__divider" />

      <DropdownMenu open={isExtraToolsMenuOpen}>
        <DropdownMenu.Trigger
          className={clsx("App-toolbar__extra-tools-trigger", {
            "App-toolbar__extra-tools-trigger--selected":
              frameToolSelected ||
              embeddableToolSelected ||
              lassoToolSelected ||
              // in collab we're already highlighting the laser button
              // outside toolbar, so let's not highlight extra-tools button
              // on top of it
              (laserToolSelected && !app.props.isCollaborating)
          })}
          onToggle={() => setIsExtraToolsMenuOpen(!isExtraToolsMenuOpen)}
          title={t("toolBar.extraTools")}
        >
          {frameToolSelected
            ? frameToolIcon
            : embeddableToolSelected
            ? EmbedIcon
            : laserToolSelected && !app.props.isCollaborating
            ? laserPointerToolIcon
            : lassoToolSelected
            ? LassoIcon
            : extraToolsIcon}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content
          onClickOutside={() => setIsExtraToolsMenuOpen(false)}
          onSelect={() => setIsExtraToolsMenuOpen(false)}
          className="App-toolbar__extra-tools-dropdown"
        >
          <DropdownMenu.Item
            onSelect={() => app.setActiveTool({ type: "frame" })}
            icon={frameToolIcon}
            shortcut={KEYS.F.toLocaleUpperCase()}
            data-testid="toolbar-frame"
            selected={frameToolSelected}
          >
            {t("toolBar.frame")}
          </DropdownMenu.Item>
          <DropdownMenu.Item
            onSelect={() => app.setActiveTool({ type: "embeddable" })}
            icon={EmbedIcon}
            data-testid="toolbar-embeddable"
            selected={embeddableToolSelected}
          >
            {t("toolBar.embeddable")}
          </DropdownMenu.Item>
          <DropdownMenu.Item
            onSelect={() => app.setActiveTool({ type: "laser" })}
            icon={laserPointerToolIcon}
            data-testid="toolbar-laser"
            selected={laserToolSelected}
            shortcut={KEYS.K.toLocaleUpperCase()}
          >
            {t("toolBar.laser")}
          </DropdownMenu.Item>
          <DropdownMenu.Item
            onSelect={() => app.setActiveTool({ type: "lasso" })}
            icon={LassoIcon}
            data-testid="toolbar-lasso"
            selected={lassoToolSelected}
          >
            {t("toolBar.lasso")}
          </DropdownMenu.Item>
          <div style={{ margin: "6px 0", fontSize: 14, fontWeight: 600 }}>
            Generate
          </div>
          {app.props.aiEnabled !== false && <TTDDialogTriggerTunnel.Out />}
          <DropdownMenu.Item
            onSelect={() => app.setOpenDialog({ name: "ttd", tab: "mermaid" })}
            icon={mermaidLogoIcon}
            data-testid="toolbar-embeddable"
          >
            {t("toolBar.mermaidToExcalidraw")}
          </DropdownMenu.Item>
          {app.props.aiEnabled !== false && app.plugins.diagramToCode && (
            <>
              <DropdownMenu.Item
                onSelect={() => app.onMagicframeToolSelect()}
                icon={MagicIcon}
                data-testid="toolbar-magicframe"
              >
                {t("toolBar.magicframe")}
                <DropdownMenu.Item.Badge>AI</DropdownMenu.Item.Badge>
              </DropdownMenu.Item>
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu>
    </>
  );
};

export const ZoomActions = ({
  renderAction,
  zoom
}: {
  renderAction: ActionManager["renderAction"];
  zoom: Zoom;
}) => (
  <Stack.Col gap={1} className={CLASSES.ZOOM_ACTIONS}>
    <Stack.Row align="center">
      {renderAction("zoomOut")}
      {renderAction("resetZoom")}
      {renderAction("zoomIn")}
    </Stack.Row>
  </Stack.Col>
);

export const UndoRedoActions = ({
  renderAction,
  className
}: {
  renderAction: ActionManager["renderAction"];
  className?: string;
}) => (
  <div className={`undo-redo-buttons ${className}`}>
    <div className="undo-button-container">
      <Tooltip label={t("buttons.undo")}>{renderAction("undo")}</Tooltip>
    </div>
    <div className="redo-button-container">
      <Tooltip label={t("buttons.redo")}> {renderAction("redo")}</Tooltip>
    </div>
  </div>
);

export const ExitZenModeAction = ({
  actionManager,
  showExitZenModeBtn
}: {
  actionManager: ActionManager;
  showExitZenModeBtn: boolean;
}) => (
  <button
    type="button"
    className={clsx("disable-zen-mode", {
      "disable-zen-mode--visible": showExitZenModeBtn
    })}
    onClick={() => actionManager.executeAction(actionToggleZenMode)}
  >
    {t("buttons.exitZenMode")}
  </button>
);

export const FinalizeAction = ({
  renderAction,
  className
}: {
  renderAction: ActionManager["renderAction"];
  className?: string;
}) => (
  <div className={`finalize-button ${className}`}>
    {renderAction("finalize", { size: "small" })}
  </div>
);
