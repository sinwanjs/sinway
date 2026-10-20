declare module "ot-json0" {
  type OtSide = "left" | "right";
  type Json0Component = {
    p: (string | number)[];
    oi?: unknown;
    od?: unknown;
    li?: unknown;
    ld?: unknown;
    lm?: number;
    na?: number;
    si?: string;
    sd?: string;
    t?: string;
    o?: unknown;
  };
  type Json0Op = Json0Component[];
  type Json0Type = {
    name: string;
    create: (data?: unknown) => unknown;
    apply: (snapshot: unknown, op: Json0Op) => unknown;
    invert: (op: Json0Op) => Json0Op;
    transform: (op: Json0Op, otherOp: Json0Op, side: OtSide) => Json0Op;
    compose: (op1: Json0Op, op2: Json0Op) => Json0Op;
  };

  const otJson0: {
    type: Json0Type;
  };

  export default otJson0;
}
