# Frame Lifecycle

## The Frame Lifecycle

Each frame runs layout then paint. This builds on the
[core concepts](intro.md#core-concepts): widgets are laid out, then painted.

## Layout Pass

The layout pass traverses the scene graph top-down, assigning each widget a
size and position. It must complete before the paint pass.

## Paint Pass

The paint pass traverses the laid-out tree and emits draw calls. It depends on
the layout pass having finished.
