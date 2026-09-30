// url=https://www.figma.com/design/kkx04GvqOzHje7Dw5ikO9X/TAPSO-Product-Marketing-Design-System?node-id=95-29
// source=apps/web/src/components/WaitlistForm.tsx
// component=TAPSO Waitlist Result
import figma from 'figma'

const instance = figma.selectedInstance
const title = instance.getString('Title')
const message = instance.getString('Message')
const actionLabel = instance.getString('Action Label')
const showAction = instance.getBoolean('Show Action')
const state = instance.getEnum('State', {
  'Success-Sent': 'Success-Sent',
  'Success-Delayed': 'Success-Delayed',
  Duplicate: 'Duplicate',
  Error: 'Error',
})

let example
if (state === 'Duplicate') {
  example = figma.code`<p className="waitlist-result waitlist-result-known">${message}</p>`
} else if (state === 'Error') {
  example = figma.code`<p className="waitlist-result waitlist-result-error">${message}</p>`
} else {
  const action = showAction
    ? `\n  <a className="figma-support" href="#support">${actionLabel}</a>`
    : ''
  example = figma.code`<div className="waitlist-result waitlist-result-success">\n  <p className="waitlist-result-mark" aria-hidden="true">🍊</p>\n  <strong role="status">${title}</strong>\n  <p>${message}</p>${action}\n</div>`
}

export default {
  example,
  id: 'tapso-waitlist-result',
  metadata: {
    nestable: true,
  },
}
