# Anomalies Tab — Feature Documentation

## Overview

A new "Anomalies" tab has been added to the episode viewer that tracks and displays joint limit violations detected during URDF replay.

## Features

### 1. **Comprehensive Anomaly Detection**

- Scans all frames in an episode for joint values that exceed URDF-specified limits
- Uses a small tolerance (0.001) to avoid false positives from floating-point precision
- Tracks violations for all mapped joints (revolute, continuous, and prismatic)

### 2. **Real-time Warning in 3D Replay**

When viewing the 3D Replay tab, violations at the current frame are shown:

- **Warning banner** displays violation count and frame number
- **Detailed list** shows each violation with:
  - Joint name
  - Actual value
  - URDF limit range
  - Source column name
- **Joint mapping table** highlights violated joints with:
  - ⚠ warning icon
  - Amber background
  - Limit range shown next to current value

### 3. **Anomalies Tab — Episode-wide Analysis**

Switch to the Anomalies tab to see a comprehensive report:

#### Summary Cards

- **Total Violations**: Total count across all frames
- **Affected Frames**: Number and percentage of frames with violations
- **Violation Rate**: Percentage of frames affected

#### Affected Joints List

- Joints ranked by violation count
- Shows how many frames each joint exceeded limits

#### Frame-by-Frame Violations

- Detailed timeline of violations
- For each affected frame:
  - Frame number and timestamp
  - All violations at that frame
  - Joint name, value, and limit range
  - Source column mapping

### 4. **Episode Navigation**

- The Anomalies tab includes the episode sidebar
- Change episodes to compare anomaly patterns
- Anomaly data is recomputed automatically when switching episodes

### 5. **No Violations State**

When an episode has no violations, a green success message is displayed showing:

- ✓ confirmation icon
- Total frames analyzed
- Confirmation that all joints are within limits

## Usage

### Accessing the Tab

1. Load a dataset with URDF support (v3.0 datasets)
2. Navigate to any episode
3. View the **3D Replay** tab (this triggers anomaly computation)
4. Switch to the **Anomalies** tab to see the full report

### Example: Your Case (Episode 54, neck_roll)

When viewing episode 54 with neck_roll at -1.4 radians:

**In 3D Replay tab** (at the problematic frame):

```
⚠ Joint Limit Violations Detected
1 joint exceeds URDF limits at frame 234:

neck_roll → -1.4000 (limit: [-1.0000, 1.0000])
Column: observation.state | neck_roll
```

**In Anomalies tab**:

```
Total Violations: 156
Affected Frames: 156 / 300
Violation Rate: 52.0%

Affected Joints:
  neck_roll    156 frames

Frame-by-Frame Violations:
  ⚠ Frame 1 @ 0.033s
    neck_roll → -1.4231 (limit: [-1.0000, 1.0000])

  ⚠ Frame 2 @ 0.067s
    neck_roll → -1.3987 (limit: [-1.0000, 1.0000])
  ...
```

## Technical Details

### Computation

- Anomalies are computed in the URDF viewer using the same joint value computation logic as the 3D visualization
- All frames are scanned when joint limits and mapping are available
- Results are cached per episode
- Switching episodes triggers recomputation

### Performance

- Computation happens asynchronously
- Loading state is shown while analyzing
- Results are memoized to avoid redundant calculations

### Data Flow

```
URDFViewer → computes all anomalies → onAnomaliesComputed callback
    ↓
EpisodeViewer → stores in state
    ↓
AnomaliesPanel → displays report
```

## Files Modified

- `src/components/anomalies-panel.tsx` — New component
- `src/components/urdf-viewer.tsx` — Added anomaly computation and export
- `src/app/[org]/[dataset]/[episode]/episode-viewer.tsx` — Integrated Anomalies tab

## Benefits

1. **Data Quality**: Quickly identify episodes with problematic joint values
2. **Debugging**: Pinpoint exact frames and joints that need attention
3. **Dataset Validation**: Ensure recorded data respects robot physical limits
4. **Collection Issues**: Detect sensor/teleoperation problems during data collection
