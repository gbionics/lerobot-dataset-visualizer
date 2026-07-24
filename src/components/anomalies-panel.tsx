"use client";

import { useMemo, useState } from "react";

export interface JointViolation {
  jointName: string;
  value: number;
  lower: number;
  upper: number;
  columnName: string;
}

export interface FrameAnomaly {
  frame: number;
  timestamp: number;
  violations: JointViolation[];
}

interface AnomaliesData {
  episodeId: number;
  totalFrames: number;
  frameAnomalies: FrameAnomaly[];
  affectedJoints: Map<string, number>; // joint name -> violation count
}

export interface EpisodeAnomalyStats {
  episodeId: number;
  totalViolations: number;
  framesWithViolations: number;
  totalFrames: number;
  violationRate: number;
  affectedJoints: string[];
}

export interface DatasetAnomaliesData {
  episodeStats: EpisodeAnomalyStats[];
  totalEpisodes: number;
  episodesWithViolations: number;
  totalViolationsAcrossAll: number;
  mostAffectedJoints: Map<string, number>; // joint name -> total violations across all episodes
}

export default function AnomaliesPanel({
  anomaliesData,
  loading,
  datasetAnomalies,
  datasetLoading,
  onLoadDatasetAnomalies,
  onComputeAllEpisodes,
  computingProgress,
}: {
  anomaliesData: AnomaliesData | null;
  loading: boolean;
  datasetAnomalies?: DatasetAnomaliesData | null;
  datasetLoading?: boolean;
  onLoadDatasetAnomalies?: () => void;
  onComputeAllEpisodes?: () => void;
  computingProgress?: { current: number; total: number } | null;
}) {
  const [viewMode, setViewMode] = useState<"episode" | "dataset">("episode");
  const stats = useMemo(() => {
    if (!anomaliesData) return null;

    const totalViolations = anomaliesData.frameAnomalies.reduce(
      (sum, fa) => sum + fa.violations.length,
      0,
    );

    const framesWithViolations = anomaliesData.frameAnomalies.length;
    const violationRate =
      anomaliesData.totalFrames > 0
        ? (framesWithViolations / anomaliesData.totalFrames) * 100
        : 0;

    return {
      totalViolations,
      framesWithViolations,
      violationRate,
    };
  }, [anomaliesData]);

  const sortedJoints = useMemo(() => {
    if (!anomaliesData) return [];
    return Array.from(anomaliesData.affectedJoints.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));
  }, [anomaliesData]);

  const sortedDatasetJoints = useMemo(() => {
    if (!datasetAnomalies) return [];
    return Array.from(datasetAnomalies.mostAffectedJoints.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));
  }, [datasetAnomalies]);

  // Handle loading for dataset view
  const handleDatasetView = () => {
    setViewMode("dataset");
    if (!datasetAnomalies && !datasetLoading && onLoadDatasetAnomalies) {
      onLoadDatasetAnomalies();
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-slate-400 text-lg animate-pulse">
          Analyzing episode data...
        </div>
      </div>
    );
  }

  if (!anomaliesData) {
    return (
      <div className="p-8 text-center text-slate-400">
        <p className="text-lg mb-2">No anomaly data available</p>
        <p className="text-sm">
          View the 3D Replay tab to analyze URDF joint violations
        </p>
      </div>
    );
  }

  if (stats && stats.totalViolations === 0) {
    return (
      <div className="p-8">
        <div className="bg-green-900/20 border border-green-700/50 rounded-lg p-6 text-center">
          <span className="text-green-400 text-4xl block mb-3">✓</span>
          <h2 className="text-green-300 font-semibold text-xl mb-2">
            No Anomalies Detected
          </h2>
          <p className="text-green-200/80">
            All joint values are within URDF-specified limits for episode{" "}
            {anomaliesData.episodeId}
          </p>
          <p className="text-green-200/60 text-sm mt-2">
            Total frames analyzed: {anomaliesData.totalFrames}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header with View Toggle */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 mb-2">
            {viewMode === "episode"
              ? `Episode ${anomaliesData.episodeId} — Anomaly Report`
              : "Dataset-Wide Anomaly Overview"}
          </h1>
          <p className="text-slate-400">
            {viewMode === "episode"
              ? "Joint limit violations detected in URDF replay data"
              : "Anomaly statistics across all episodes"}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setViewMode("episode")}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              viewMode === "episode"
                ? "bg-orange-600 text-white"
                : "bg-slate-700 text-slate-300 hover:bg-slate-600"
            }`}
          >
            Current Episode
          </button>
          <button
            onClick={handleDatasetView}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              viewMode === "dataset"
                ? "bg-orange-600 text-white"
                : "bg-slate-700 text-slate-300 hover:bg-slate-600"
            }`}
          >
            All Episodes
          </button>
        </div>
      </div>

      {viewMode === "episode" ? (
        <>
          {/* Episode View - Summary Cards */}
          {stats && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
                <div className="text-slate-400 text-sm mb-1">
                  Total Violations
                </div>
                <div className="text-3xl font-bold text-amber-400">
                  {stats.totalViolations}
                </div>
              </div>
              <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
                <div className="text-slate-400 text-sm mb-1">
                  Affected Frames
                </div>
                <div className="text-3xl font-bold text-amber-400">
                  {stats.framesWithViolations}
                  <span className="text-lg text-slate-500 ml-2">
                    / {anomaliesData.totalFrames}
                  </span>
                </div>
              </div>
              <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
                <div className="text-slate-400 text-sm mb-1">
                  Violation Rate
                </div>
                <div className="text-3xl font-bold text-amber-400">
                  {stats.violationRate.toFixed(1)}%
                </div>
              </div>
            </div>
          )}

          {/* Episode View - Affected Joints */}
          {sortedJoints.length > 0 && (
            <div className="bg-slate-800 border border-slate-700 rounded-lg p-5">
              <h2 className="text-lg font-semibold text-slate-100 mb-4">
                Affected Joints
              </h2>
              <div className="space-y-2">
                {sortedJoints.map(({ name, count }) => (
                  <div
                    key={name}
                    className="flex items-center justify-between bg-slate-900/50 rounded px-3 py-2"
                  >
                    <span className="font-mono text-slate-200">{name}</span>
                    <span className="text-amber-400 font-semibold">
                      {count} frame{count === 1 ? "" : "s"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Episode View - Frame-by-Frame List */}
          <div className="bg-slate-800 border border-slate-700 rounded-lg p-5">
            <h2 className="text-lg font-semibold text-slate-100 mb-4">
              Frame-by-Frame Violations
            </h2>
            <div className="space-y-3 max-h-[600px] overflow-y-auto">
              {anomaliesData.frameAnomalies.map((fa) => (
                <div
                  key={fa.frame}
                  className="bg-amber-900/20 border border-amber-700/50 rounded-lg p-4"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <span className="text-amber-400 text-lg">⚠</span>
                      <div>
                        <span className="text-slate-200 font-semibold">
                          Frame {fa.frame + 1}
                        </span>
                        <span className="text-slate-500 text-sm ml-3">
                          @ {fa.timestamp.toFixed(3)}s
                        </span>
                      </div>
                    </div>
                    <span className="text-amber-300 text-sm font-semibold">
                      {fa.violations.length} violation
                      {fa.violations.length === 1 ? "" : "s"}
                    </span>
                  </div>

                  <div className="space-y-2 ml-8">
                    {fa.violations.map((v, idx) => (
                      <div
                        key={idx}
                        className="text-xs font-mono bg-slate-900/60 rounded px-3 py-2"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-amber-300 font-semibold">
                            {v.jointName}
                          </span>
                          <span className="text-slate-400">{v.columnName}</span>
                        </div>
                        <div className="mt-1 text-slate-300">
                          <span className="text-white font-semibold">
                            {v.value.toFixed(4)}
                          </span>
                          <span className="text-slate-500 ml-2">
                            (limit: [{v.lower.toFixed(4)}, {v.upper.toFixed(4)}
                            ])
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : (
        <>
          {/* Dataset View */}
          {datasetLoading ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-slate-400 text-lg animate-pulse">
                Analyzing all episodes...
              </div>
            </div>
          ) : datasetAnomalies ? (
            <>
              {/* Info Banner - Episodes Analyzed */}
              {datasetAnomalies.episodeStats.length <
                datasetAnomalies.totalEpisodes && (
                <div className="bg-blue-900/20 border border-blue-700/50 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <span className="text-blue-400 text-lg">ℹ</span>
                    <div className="flex-1">
                      <p className="text-blue-200 text-sm">
                        <strong>
                          {datasetAnomalies.episodeStats.length} out of{" "}
                          {datasetAnomalies.totalEpisodes} episodes analyzed
                        </strong>
                      </p>
                      <p className="text-blue-200/70 text-xs mt-1">
                        View more episodes in the 3D Replay tab to see complete
                        dataset statistics. Only episodes you&apos;ve viewed are
                        analyzed for violations.
                      </p>
                      {onComputeAllEpisodes && (
                        <button
                          onClick={onComputeAllEpisodes}
                          disabled={!!computingProgress}
                          className="mt-3 px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white text-sm font-medium rounded transition-colors"
                        >
                          {computingProgress
                            ? `Analyzing ${computingProgress.current}/${computingProgress.total}...`
                            : `Analyze All Episodes (may take several minutes)`}
                        </button>
                      )}
                      {computingProgress && (
                        <div className="mt-2">
                          <div className="w-full bg-slate-700 rounded-full h-2">
                            <div
                              className="bg-amber-500 h-2 rounded-full transition-all duration-300"
                              style={{
                                width: `${(computingProgress.current / computingProgress.total) * 100}%`,
                              }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Dataset Summary Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
                  <div className="text-slate-400 text-sm mb-1">
                    Episodes with Violations
                  </div>
                  <div className="text-3xl font-bold text-amber-400">
                    {datasetAnomalies.episodesWithViolations}
                    <span className="text-lg text-slate-500 ml-2">
                      / {datasetAnomalies.totalEpisodes}
                    </span>
                  </div>
                </div>
                <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
                  <div className="text-slate-400 text-sm mb-1">
                    Total Violations
                  </div>
                  <div className="text-3xl font-bold text-amber-400">
                    {datasetAnomalies.totalViolationsAcrossAll.toLocaleString()}
                  </div>
                </div>
                <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
                  <div className="text-slate-400 text-sm mb-1">
                    Violation Rate
                  </div>
                  <div className="text-3xl font-bold text-amber-400">
                    {(
                      (datasetAnomalies.episodesWithViolations /
                        datasetAnomalies.totalEpisodes) *
                      100
                    ).toFixed(1)}
                    %
                  </div>
                </div>
              </div>

              {/* Dataset - Most Affected Joints */}
              {sortedDatasetJoints.length > 0 && (
                <div className="bg-slate-800 border border-slate-700 rounded-lg p-5">
                  <h2 className="text-lg font-semibold text-slate-100 mb-4">
                    Most Affected Joints (Across All Episodes)
                  </h2>
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {sortedDatasetJoints.map(({ name, count }) => (
                      <div
                        key={name}
                        className="flex items-center justify-between bg-slate-900/50 rounded px-3 py-2"
                      >
                        <span className="font-mono text-slate-200">{name}</span>
                        <span className="text-amber-400 font-semibold">
                          {count.toLocaleString()} violation
                          {count === 1 ? "" : "s"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Dataset - Episode Rankings */}
              <div className="bg-slate-800 border border-slate-700 rounded-lg p-5">
                <h2 className="text-lg font-semibold text-slate-100 mb-4">
                  Episodes Ranked by Violations
                </h2>
                <div className="space-y-2 max-h-[600px] overflow-y-auto">
                  {datasetAnomalies.episodeStats
                    .filter((ep) => ep.totalViolations > 0)
                    .sort((a, b) => b.totalViolations - a.totalViolations)
                    .map((ep, idx) => (
                      <div
                        key={ep.episodeId}
                        className="bg-slate-900/50 rounded px-4 py-3"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-3">
                            <span className="text-slate-500 font-mono text-sm">
                              #{idx + 1}
                            </span>
                            <span className="text-slate-200 font-semibold">
                              Episode {ep.episodeId}
                            </span>
                          </div>
                          <span className="text-amber-400 font-semibold">
                            {ep.totalViolations} violation
                            {ep.totalViolations === 1 ? "" : "s"}
                          </span>
                        </div>
                        <div className="flex items-center gap-4 text-xs text-slate-400">
                          <span>
                            {ep.framesWithViolations} / {ep.totalFrames} frames
                            ({ep.violationRate.toFixed(1)}%)
                          </span>
                          <span>
                            Joints: {ep.affectedJoints.slice(0, 3).join(", ")}
                            {ep.affectedJoints.length > 3 &&
                              ` +${ep.affectedJoints.length - 3} more`}
                          </span>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            </>
          ) : (
            <div className="p-8 text-center text-slate-400">
              <p className="text-lg mb-2">
                Dataset-wide analysis not yet available
              </p>
              <p className="text-sm mb-4">
                View episodes in the 3D Replay tab, or click below to analyze
                all episodes at once.
              </p>
              {onComputeAllEpisodes && (
                <div className="inline-block">
                  <button
                    onClick={onComputeAllEpisodes}
                    disabled={!!computingProgress}
                    className="px-6 py-3 bg-amber-600 hover:bg-amber-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
                  >
                    {computingProgress
                      ? `Analyzing ${computingProgress.current}/${computingProgress.total}...`
                      : `Analyze All Episodes`}
                  </button>
                  <p className="text-xs text-amber-400/70 mt-2">
                    ⚠ This may take several minutes for large datasets
                  </p>
                  {computingProgress && (
                    <div className="mt-3 w-64 mx-auto">
                      <div className="w-full bg-slate-700 rounded-full h-2">
                        <div
                          className="bg-amber-500 h-2 rounded-full transition-all duration-300"
                          style={{
                            width: `${(computingProgress.current / computingProgress.total) * 100}%`,
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
