# Widget Engine Guide

## Overview

The Widget Engine renders widgets to a canvas. It is built around three ideas:
a scene graph, a layout pass, and a paint pass. Read this overview before the
other sections.

## Core Concepts

A **widget** is a node in the scene graph. The **layout pass** computes sizes
and positions; the **paint pass** draws each widget. See the
[lifecycle](lifecycle.md#the-frame-lifecycle) for how these fit together.

## Coordinate System

Coordinates are top-left origin, y grows downward. The layout pass works in
this coordinate system.
