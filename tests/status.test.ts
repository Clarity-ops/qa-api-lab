import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { login, makeOrderPayload } from "./helpers";
import { expectSchema } from "./schema";
import { orderSchema } from "./schemas/order.schema";

describe("PATCH /orders/:id/status (Варіант 1)", () => {
  let app: ReturnType<typeof createApp>;
  let token: string;

  beforeEach(async () => {
    app = createApp();
    token = await login(app, "bob@example.com");
  });

  it("успішна зміна статусу: 200 OK, заголовки, контракт (JSON Schema), значення та побічний ефект", async () => {
    // 1. Створення замовлення
    const created = await request(app).post("/orders").set("Authorization", `Bearer ${token}`).send(makeOrderPayload());

    const orderId = created.body.id;
    expect(created.body.status).toBe("new");

    // 2. PATCH new -> paid (Рівні 1-4)
    const patchRes = await request(app).patch(`/orders/${orderId}/status`).set("Authorization", `Bearer ${token}`).send({ status: "paid" });

    expect(patchRes.status).toBe(200); // Рівень 1: Код стану
    expect(patchRes.headers["content-type"]).toMatch(/json/); // Рівень 4: Заголовок Content-Type
    expect(patchRes.body.status).toBe("paid"); // Рівень 3: Значення відповіді
    expectSchema(patchRes.body, orderSchema); // Рівень 2: Валідація за JSON Schema

    // 3. GET /orders/:id (Рівень 5: Побічний ефект)
    const getRes = await request(app).get(`/orders/${orderId}`).set("Authorization", `Bearer ${token}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.status).toBe("paid");
  });

  describe("Параметризоване тестування коректних переходів (200 OK)", () => {
    it.each([
      { from: "new", to: "paid" },
      { from: "paid", to: "shipped" },
    ])("перехід $from → $to дозволений", async ({ from, to }) => {
      const created = await request(app).post("/orders").set("Authorization", `Bearer ${token}`).send(makeOrderPayload());

      const orderId = created.body.id;

      if (from === "paid") {
        await request(app).patch(`/orders/${orderId}/status`).set("Authorization", `Bearer ${token}`).send({ status: "paid" });
      }

      const res = await request(app).patch(`/orders/${orderId}/status`).set("Authorization", `Bearer ${token}`).send({ status: to });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe(to);
    });
  });

  describe("Параметризоване тестування заборонених переходів (409 Conflict)", () => {
    it.each([
      { current: "new", target: "shipped" },
      { current: "new", target: "new" },
      { current: "paid", target: "new" },
      { current: "paid", target: "paid" },
      { current: "shipped", target: "paid" },
      { current: "shipped", target: "new" },
    ])("перехід $current → $target відхиляється з 409", async ({ current, target }) => {
      const created = await request(app).post("/orders").set("Authorization", `Bearer ${token}`).send(makeOrderPayload());

      const orderId = created.body.id;

      if (current === "paid") {
        await request(app).patch(`/orders/${orderId}/status`).set("Authorization", `Bearer ${token}`).send({ status: "paid" });
      } else if (current === "shipped") {
        await request(app).patch(`/orders/${orderId}/status`).set("Authorization", `Bearer ${token}`).send({ status: "paid" });
        await request(app).patch(`/orders/${orderId}/status`).set("Authorization", `Bearer ${token}`).send({ status: "shipped" });
      }

      const res = await request(app).patch(`/orders/${orderId}/status`).set("Authorization", `Bearer ${token}`).send({ status: target });

      expect(res.status).toBe(409); // Рівень 1: Код 409 Conflict при недозволеному переході
      expect(res.body.code).toBe("INVALID_STATUS_TRANSITION");
    });
  });

  describe("Валідація та перевірки доступу", () => {
    it("повертає 400 при передачі неіснуючого статусу", async () => {
      const created = await request(app).post("/orders").set("Authorization", `Bearer ${token}`).send(makeOrderPayload());

      const res = await request(app).patch(`/orders/${created.body.id}/status`).set("Authorization", `Bearer ${token}`).send({ status: "invalid_status" });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("INVALID_STATUS");
    });

    it.each([
      { name: "без токена", header: undefined },
      { name: "підроблений токен", header: "Bearer invalid-token" },
    ])("PATCH /orders/:id/status $name → 401", async ({ header }) => {
      const req = request(app).patch("/orders/some-id/status").send({ status: "paid" });
      if (header) req.set("Authorization", header);
      const res = await req;
      expect(res.status).toBe(401);
    });

    it("спроба змінити статус чужого замовлення повертає 404, а не 403", async () => {
      const alice = await login(app, "alice@example.com");
      const bob = await login(app, "bob@example.com");

      const created = await request(app).post("/orders").set("Authorization", `Bearer ${alice}`).send(makeOrderPayload());

      const res = await request(app).patch(`/orders/${created.body.id}/status`).set("Authorization", `Bearer ${bob}`).send({ status: "paid" });

      expect(res.status).toBe(404);
    });
  });
});
