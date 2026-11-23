"use client";

import React, { useMemo } from "react";
import type { DatasetLimitScan } from "@/app/[org]/[dataset]/[episode]/fetch-data";
import { formatOvershoot, type JointViolation } from "@/utils/jointLimits";
import {
  EpisodeLink,
  FlagAllButton,
  FlagButton,
  InlineLoading,
  PageHeader,
  StatCard,
} from "@/components/ui";

const SECTION = "bg-[var(--surface-1)]/60 rounded-lg p-5 border border-line";

type JointTotal = {
  joint: string;
  type: JointViolation["type"];
  episodes: number;
  frames: number;
  worst: number;
  worstEpisode: number;
};

/** Every episode's frames past a joint limit of the robot model. */
export default function JointLimitsPanel({
  scan,
  loading,
  failed,
  progress,
}: {
  scan: DatasetLimitScan | null;
  loading: boolean;
  failed: boolean;
  progress: { done: number; total: number } | null;
}) {
  const summary = useMemo(() => {
    if (!scan) return null;
    const over = scan.episodes
      .filter((e) => e.report.joints.length > 0)
      .sort((a, b) => b.report.framesOver - a.report.framesOver);
    const joints = new Map<string, JointTotal>();
    let frames = 0;
    let framesOver = 0;
    for (const { episode, report } of scan.episodes) {
      frames += report.totalFrames;
      framesOver += report.framesOver;
      for (const v of report.joints) {
        const t = joints.get(v.joint) ?? {
          joint: v.joint,
          type: v.type,
          episodes: 0,
          frames: 0,
          worst: 0,
          worstEpisode: episode,
        };
        t.episodes++;
        t.frames += v.frames;
        if (v.worst > t.worst) {
          t.worst = v.worst;
          t.worstEpisode = episode;
        }
        joints.set(v.joint, t);
      }
    }
    return {
      over,
      frames,
      framesOver,
      joints: [...joints.values()].sort((a, b) => b.frames - a.frames),
    };
  }, [scan]);

  return (
    <div className="w-full max-w-5xl mx-auto py-6 space-y-6">
      <PageHeader
        title="Joint Limits"
        description="Frames where a joint goes past the limits the robot model's URDF gives it, in every episode."
      />

      {loading && (
        <InlineLoading
          label={
            progress && progress.total > 1
              ? `Reading episodes… ${progress.done} of ${progress.total}`
              : "Reading episodes…"
          }
        />
      )}
      {failed && (
        <p className="text-sm text-fg-muted">
          The robot model or the episodes couldn&apos;t be read.
        </p>
      )}

      {scan && summary && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard
              label="Episodes over a limit"
              value={`${summary.over.length} / ${scan.episodes.length}`}
              detail={
                scan.failed.length > 0
                  ? `${scan.failed.length} unreadable`
                  : undefined
              }
            />
            <StatCard
              label="Frames over a limit"
              value={summary.framesOver.toLocaleString()}
              detail={
                summary.frames > 0
                  ? `${((summary.framesOver / summary.frames) * 100).toFixed(1)}% of ${summary.frames.toLocaleString()}`
                  : undefined
              }
            />
            <StatCard
              label="Joints over a limit"
              value={summary.joints.length}
            />
            <StatCard
              label="Worst overshoot"
              value={
                summary.joints.length > 0
                  ? formatOvershoot(
                      Math.max(...summary.joints.map((j) => j.worst)),
                      summary.joints.reduce((a, b) =>
                        b.worst > a.worst ? b : a,
                      ).type,
                    )
                  : "—"
              }
            />
          </div>

          {summary.over.length === 0 ? (
            <div className={SECTION}>
              <p className="text-sm text-fg-muted">
                Every joint stays within its limits in every episode.
              </p>
            </div>
          ) : (
            <>
              <div className={SECTION}>
                <div className="flex items-center justify-between gap-3 mb-3">
                  <h3 className="text-sm font-semibold text-fg">Episodes</h3>
                  <FlagAllButton ids={summary.over.map((e) => e.episode)} />
                </div>
                <div className="max-h-96 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-fg-faint border-b border-line">
                        <th className="w-5 py-1" />
                        <th className="text-left py-1 pr-3 font-normal">
                          Episode
                        </th>
                        <th className="text-right py-1 pr-3 font-normal">
                          Frames over
                        </th>
                        <th className="text-right py-1 pr-3 font-normal">
                          Joints
                        </th>
                        <th className="text-left py-1 font-normal">Worst</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.over.map(({ episode, report }) => {
                        const worst = report.joints.reduce((a, b) =>
                          b.worst > a.worst ? b : a,
                        );
                        return (
                          <tr
                            key={episode}
                            className="border-b border-line-subtle text-fg-soft"
                          >
                            <td className="py-1">
                              <FlagButton id={episode} />
                            </td>
                            <td className="py-1 pr-3 whitespace-nowrap">
                              <EpisodeLink episode={episode} />
                            </td>
                            <td className="py-1 pr-3 text-right tabular whitespace-nowrap">
                              {report.framesOver} / {report.totalFrames}
                            </td>
                            <td className="py-1 pr-3 text-right tabular">
                              {report.joints.length}
                            </td>
                            <td className="py-1 whitespace-nowrap">
                              <span className="font-mono">{worst.joint}</span>{" "}
                              <span className="text-critical-fg tabular">
                                {formatOvershoot(worst.worst, worst.type)}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className={SECTION}>
                <h3 className="text-sm font-semibold text-fg mb-3">Joints</h3>
                <div className="max-h-96 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-fg-faint border-b border-line">
                        <th className="text-left py-1 pr-3 font-normal">
                          Joint
                        </th>
                        <th className="text-right py-1 pr-3 font-normal">
                          Episodes
                        </th>
                        <th className="text-right py-1 pr-3 font-normal">
                          Frames
                        </th>
                        <th className="text-left py-1 font-normal">Worst</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.joints.map((j) => (
                        <tr
                          key={j.joint}
                          className="border-b border-line-subtle text-fg-soft"
                        >
                          <td className="py-1 pr-3 font-mono">{j.joint}</td>
                          <td className="py-1 pr-3 text-right tabular">
                            {j.episodes}
                          </td>
                          <td className="py-1 pr-3 text-right tabular">
                            {j.frames}
                          </td>
                          <td className="py-1 whitespace-nowrap">
                            <span className="text-critical-fg tabular">
                              {formatOvershoot(j.worst, j.type)}
                            </span>{" "}
                            <span className="text-fg-faint">in</span>{" "}
                            <EpisodeLink episode={j.worstEpisode} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
