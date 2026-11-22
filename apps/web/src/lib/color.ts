// Colors from other players end up in CSS (`background`) and Konva fills. A free-form string could
// be `url(https://tracker/x)`, which makes every viewer's browser fetch that URL. Only plain
// #rrggbb hex colors are accepted.
export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}
