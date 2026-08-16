import { arrayToMap } from "@excalidraw/common";
import {
  isFrameLikeElement,
  newElement,
  newFrameElement,
} from "@excalidraw/element";

import type {
  ExcalidrawElement,
  FractionalIndex,
} from "@excalidraw/element/types";

import {
  generateProgressiveRevealFromFrame,
  getOrderedRevealUnitsInFrame,
} from "../actions/actionProgressiveReveal";

const idx = (value: string) => value as FractionalIndex;

const makeFrame = () =>
  newFrameElement({
    x: 0,
    y: 0,
    width: 400,
    height: 300,
    name: "Diagram",
  });

const makeRect = ({
  frameId,
  index,
  groupIds = [],
  x = 10,
}: {
  frameId: string;
  index: string;
  groupIds?: string[];
  x?: number;
}) =>
  newElement({
    type: "rectangle",
    x,
    y: 10,
    width: 50,
    height: 50,
    frameId,
    index: idx(index),
    groupIds,
  });

const unitsFor = (elements: readonly ExcalidrawElement[], frameId: string) =>
  getOrderedRevealUnitsInFrame(elements, frameId, arrayToMap(elements));

const framesByY = (elements: readonly ExcalidrawElement[]) =>
  elements
    .filter(isFrameLikeElement)
    .slice()
    .sort((a, b) => a.y - b.y);

const namesInFrame = (
  elements: readonly ExcalidrawElement[],
  frameId: string,
) =>
  elements
    .filter((el) => el.frameId === frameId && !isFrameLikeElement(el))
    .map(
      (el) =>
        (el as ExcalidrawElement & { customData?: { name?: string } })
          .customData?.name ?? el.id,
    )
    .sort();

describe("getOrderedRevealUnitsInFrame", () => {
  it("treats ungrouped shapes as one step each", () => {
    // Arrange: three independent rectangles in a frame
    const frame = makeFrame();
    const a = makeRect({ frameId: frame.id, index: "a1" });
    const b = makeRect({ frameId: frame.id, index: "a2", x: 70 });
    const c = makeRect({ frameId: frame.id, index: "a3", x: 130 });

    // Act
    const units = unitsFor([frame, a, b, c], frame.id);

    // Assert: each shape is its own reveal step, in index order
    expect(units).toHaveLength(3);
    expect(units.map((unit) => unit.id)).toEqual([a.id, b.id, c.id]);
    expect(units.every((unit) => !unit.isGroup)).toBe(true);
  });

  it("collapses an Excalidraw group into a single reveal step", () => {
    // Arrange: A is alone; B and C share a group so they should appear together
    const frame = makeFrame();
    const a = makeRect({ frameId: frame.id, index: "a1" });
    const b = makeRect({
      frameId: frame.id,
      index: "a2",
      x: 70,
      groupIds: ["g1"],
    });
    const c = makeRect({
      frameId: frame.id,
      index: "a3",
      x: 130,
      groupIds: ["g1"],
    });

    // Act
    const units = unitsFor([frame, a, b, c], frame.id);

    // Assert: two steps — A, then the B+C group
    expect(units).toHaveLength(2);
    expect(units[0].id).toBe(a.id);
    expect(units[0].isGroup).toBe(false);
    expect(units[1].id).toBe("g1");
    expect(units[1].isGroup).toBe(true);
    expect(units[1].elements.map((el) => el.id)).toEqual([b.id, c.id]);
  });

  it("uses the outermost group when groups are nested", () => {
    // Arrange: A and B share an inner group, and all three share an outer group
    const frame = makeFrame();
    const a = makeRect({
      frameId: frame.id,
      index: "a1",
      groupIds: ["inner", "outer"],
    });
    const b = makeRect({
      frameId: frame.id,
      index: "a2",
      x: 70,
      groupIds: ["inner", "outer"],
    });
    const c = makeRect({
      frameId: frame.id,
      index: "a3",
      x: 130,
      groupIds: ["outer"],
    });

    // Act
    const units = unitsFor([frame, a, b, c], frame.id);

    // Assert: the outer group is one step, not the inner pair plus C
    expect(units).toHaveLength(1);
    expect(units[0].id).toBe("outer");
    expect(units[0].elements.map((el) => el.id)).toEqual([a.id, b.id, c.id]);
  });

  it("treats a leftover 1-member group as a normal item", () => {
    // Arrange: grouping leftover with a single member should not look like a group
    const frame = makeFrame();
    const a = makeRect({
      frameId: frame.id,
      index: "a1",
      groupIds: ["g-solo"],
    });

    // Act
    const units = unitsFor([frame, a], frame.id);

    // Assert
    expect(units).toHaveLength(1);
    expect(units[0].id).toBe(a.id);
    expect(units[0].isGroup).toBe(false);
  });
});

describe("generateProgressiveRevealFromFrame", () => {
  it("creates one slide per ungrouped shape", () => {
    // Arrange
    const frame = makeFrame();
    const a = makeRect({ frameId: frame.id, index: "a1" });
    const b = makeRect({ frameId: frame.id, index: "a2", x: 70 });
    const c = makeRect({ frameId: frame.id, index: "a3", x: 130 });

    // Act
    const next = generateProgressiveRevealFromFrame([frame, a, b, c], frame, {
      editingGroupId: null,
    });

    // Assert: 3 slides with 1, then 2, then 3 shapes (names come from source ids)
    const slides = framesByY(next);
    expect(slides).toHaveLength(3);
    expect(namesInFrame(next, slides[0].id)).toEqual([a.id].sort());
    expect(namesInFrame(next, slides[1].id)).toEqual([a.id, b.id].sort());
    expect(namesInFrame(next, slides[2].id)).toEqual([a.id, b.id, c.id].sort());
  });

  it("puts grouped shapes on the same slide as one step", () => {
    // Arrange: group B+C so they appear together instead of one-by-one
    const frame = makeFrame();
    const a = makeRect({ frameId: frame.id, index: "a1" });
    const b = makeRect({
      frameId: frame.id,
      index: "a2",
      x: 70,
      groupIds: ["g1"],
    });
    const c = makeRect({
      frameId: frame.id,
      index: "a3",
      x: 130,
      groupIds: ["g1"],
    });

    // Act
    const next = generateProgressiveRevealFromFrame([frame, a, b, c], frame, {
      editingGroupId: null,
    });

    // Assert: 2 slides — A, then A plus the whole group
    const slides = framesByY(next);
    expect(slides).toHaveLength(2);
    expect(namesInFrame(next, slides[0].id)).toEqual([a.id].sort());
    expect(namesInFrame(next, slides[1].id)).toEqual([a.id, b.id, c.id].sort());
  });

  it("keeps group membership on a slide and does not share group ids across slides", () => {
    // Arrange
    const frame = makeFrame();
    const a = makeRect({
      frameId: frame.id,
      index: "a1",
      groupIds: ["g1"],
    });
    const b = makeRect({
      frameId: frame.id,
      index: "a2",
      x: 70,
      groupIds: ["g1"],
    });
    const c = makeRect({ frameId: frame.id, index: "a3", x: 130 });

    // Act
    const next = generateProgressiveRevealFromFrame([frame, a, b, c], frame, {
      editingGroupId: null,
    });

    // Assert: grouped copies on a slide share a group id; later slides use a new one
    const slides = framesByY(next);
    expect(slides).toHaveLength(2);

    const slide1Group = next.filter(
      (el) => el.frameId === slides[0].id && !isFrameLikeElement(el),
    );
    expect(slide1Group).toHaveLength(2);
    expect(slide1Group[0].groupIds[0]).toBe(slide1Group[1].groupIds[0]);

    const slide2Group = next.filter(
      (el) =>
        el.frameId === slides[1].id &&
        !isFrameLikeElement(el) &&
        (el.customData?.name === a.id || el.customData?.name === b.id),
    );
    expect(slide2Group).toHaveLength(2);
    expect(slide2Group[0].groupIds[0]).toBe(slide2Group[1].groupIds[0]);
    expect(slide1Group[0].groupIds[0]).not.toBe(slide2Group[0].groupIds[0]);
  });
});
