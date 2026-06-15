import { describe, expect, it } from 'vitest';
import { pickClipName, type ClipRole } from '@/gfx/models';

// Real clip names from the two CC0 rigs the avatar pipeline targets, so the
// hero GLB can be swapped without code changes and still resolve correctly.
const KAYKIT = [
  'Idle', 'Walking_A', 'Walking_B', 'Walking_Backwards', 'Running_A', 'Running_B',
  'Running_Strafe_Left', 'Jump_Idle', 'Jump_Full_Long', 'Jump_Start', 'Jump_Land',
  'Sit_Chair_Idle', 'Sit_Chair_Down', 'Sit_Floor_Idle', 'Cheer', 'Death_A',
];
const ROBOT = [
  'Dance', 'Death', 'Idle', 'Jump', 'No', 'Punch', 'Running', 'Sitting',
  'Standing', 'ThumbsUp', 'Walking', 'WalkJump', 'Wave', 'Yes',
];

describe('pickClipName (avatar clip role resolution)', () => {
  it('maps every role to a sensible KayKit clip', () => {
    expect(pickClipName(KAYKIT, 'idle')).toBe('Idle');
    // Prefers the primary looping clip, not "Walking_Backwards".
    expect(pickClipName(KAYKIT, 'walk')).toBe('Walking_A');
    expect(pickClipName(KAYKIT, 'run')).toBe('Running_A');
    // The held airborne pose, not the one-shot start/land transitions.
    expect(pickClipName(KAYKIT, 'jump')).toBe('Jump_Idle');
    // The held sitting pose, not the sit-down transition.
    expect(pickClipName(KAYKIT, 'sit')).toBe('Sit_Chair_Idle');
  });

  it('maps every role to a sensible RobotExpressive clip', () => {
    expect(pickClipName(ROBOT, 'idle')).toBe('Idle');
    expect(pickClipName(ROBOT, 'walk')).toBe('Walking');
    expect(pickClipName(ROBOT, 'run')).toBe('Running');
    expect(pickClipName(ROBOT, 'jump')).toBe('Jump');
    expect(pickClipName(ROBOT, 'sit')).toBe('Sitting');
  });

  it('never returns null when any clips exist, and is case-insensitive', () => {
    const roles: ClipRole[] = ['idle', 'walk', 'run', 'jump', 'sit'];
    for (const r of roles) {
      expect(pickClipName(['MysteryClip'], r)).toBe('MysteryClip');
      expect(pickClipName(['WALKING'], 'walk')).toBe('WALKING');
    }
    expect(pickClipName([], 'walk')).toBeNull();
  });
});
