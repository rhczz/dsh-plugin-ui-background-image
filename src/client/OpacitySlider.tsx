/**
 * The opacity control: one range input with its label and readout.
 *
 * A drag is previewed as it happens and persisted once it settles, so the
 * component reports both moments: `onPreview` for every movement, and `onCommit`
 * when the pointer, the keyboard, or the focus leaves the control. The native
 * range input is used because `ui-primitives` has no slider and promoting one
 * needs a second consumer; it also carries the keyboard model and the value
 * semantics this control would otherwise have to reimplement.
 * @module dsh-plugin-ui-background-image/client/OpacitySlider
 */

import type { PointerEvent as ReactPointerEvent, FocusEvent as ReactFocusEvent, KeyboardEvent as ReactKeyboardEvent, FormEvent as ReactFormEvent } from 'react'
import { BACKGROUND_OPACITY_MAX, BACKGROUND_OPACITY_MIN } from '../background-opacity.ts'
import css from './OpacitySlider.module.css'

/** Props of the opacity control. */
export interface OpacitySliderProps {
  /** Accessible name, and the field's visible label. */
  label: string
  /** Formatted value shown beside the label. */
  readout: string
  /** One line explaining which direction makes the background stronger. */
  hint: string
  /** Value the control is at. */
  value: number
  /** Called for every movement, without persisting anything. */
  onPreview: (opacity: number) => void
  /** Called once the movement settles. */
  onCommit: (opacity: number) => void
}

/**
 * Render the opacity control.
 * @param props - copy, value, and the two write moments.
 * @returns the field element tree.
 */
export function OpacitySlider({ label, readout, hint, value, onPreview, onCommit }: OpacitySliderProps) {
  const commitFrom = (event: ReactPointerEvent | ReactKeyboardEvent | ReactFocusEvent): void => {
    onCommit(Number((event.currentTarget as HTMLInputElement).value))
  }
  return (
    <div className={css.field}>
      <div className={css.head}>
        <span className={css.label}>{label}</span>
        <span className={css.readout}>{readout}</span>
      </div>
      <input
        type="range"
        className={css.range}
        min={BACKGROUND_OPACITY_MIN}
        max={BACKGROUND_OPACITY_MAX}
        step={1}
        value={value}
        aria-label={label}
        aria-valuetext={readout}
        onInput={(event: ReactFormEvent<HTMLInputElement>) => { onPreview(Number(event.currentTarget.value)) }}
        onPointerUp={commitFrom}
        onKeyUp={commitFrom}
        onBlur={commitFrom}
      />
      <div className={css.hint}>{hint}</div>
    </div>
  )
}
