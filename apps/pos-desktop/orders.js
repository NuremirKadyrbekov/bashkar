"use strict";
let orderSession = null,
  orderBusy = false,
  orderRefresh = false,
  orderCache = null;
function initOrderUi(ru, ky, errors) {
  Object.assign(ru, {
    orderWorkspace: "Заказ и черновик",
    acceptedOrder: "Принято",
    orderDraft: "Черновик — не принят",
    noOrder: "Принятых пакетов пока нет",
    noDraft: "Черновик пуст",
    draftSaved: "Черновик сохранён на этом устройстве",
    draftSaving: "Сохранение черновика…",
    printDisconnected:
      "Печать не подключена. Задания кухни сохраняются в очереди.",
    printPending: "Ожидает печати — печать не подключена",
    printNotRequired: "Печать не требуется",
    searchDish: "Поиск блюда",
    chooseCategory: "Категория",
    allCategories: "Все категории",
    addDish: "Добавить",
    editLine: "Изменить строку",
    removeLine: "Удалить строку",
    saveLine: "Сохранить строку",
    lineComment: "Комментарий (до 300 символов)",
    lineQuantity: "Количество",
    lineVariant: "Размер",
    lineEditHint:
      "Изменения этой формы сохранятся после нажатия «Сохранить строку».",
    clearOrderDraft: "Очистить черновик",
    clearOrderConfirm: "Удалить все строки этого черновика?",
    checkBatch: "Проверить и отправить",
    acceptBatch: "Принять пакет",
    batchPreview: "Подтверждение пакета",
    batchAccepted: "Пакет принят",
    batchLabel: "Пакет",
    draftUnknown:
      "Результат отправки неизвестен. Черновик зафиксирован; проверьте исходную отправку.",
    retryBatch: "Проверить исходную отправку",
    orderDiscount: "Фиксированная скидка",
    setOrderDiscount: "Сохранить скидку",
    confirmDiscount: "Подтвердить изменение скидки",
    orderSubtotal: "Товары",
    orderTotal: "Подтверждённый итог",
    newGoods: "Новые товары",
    newOrderTotal: "Итог после добавления",
    estimatedDraft: "Ориентировочно новые товары",
    menuChangedOrder:
      "Редакция меню изменилась. Проверьте актуальные цены и состав ниже; без вашего подтверждения пакет не будет принят.",
    conditionsChanged:
      "Условия изменились. Пакет не принят; сохранённый черновик нужно проверить и подтвердить заново.",
    moreBatches: "Ещё пакеты",
    orderBack: "К списку столов",
    submitBatchPermission: "Отправка TABLE-пакетов",
    discountPermission: "Фиксированная скидка заказа",
    previewOnly:
      "Это подтверждение условий. Пакет и задания кухни сохранятся после приёмки.",
    draftUnavailable:
      "Посещение закрыто. Черновик сохранён, отправка запрещена.",
    closeDraftWarning:
      "У посещения есть локальный черновик. Закрыть посещение? Отправить этот черновик после закрытия будет нельзя; в новое посещение он не переносится.",
    frozenEditing: "Сначала выясните результат исходной отправки.",
    discardLine: "Изменения формы не сохранены. Закрыть?",
    kitchenSnapshot: "Состав задания кухни",
    currentOrderTotal: "Текущий подтверждённый итог",
  });
  Object.assign(ky, {
    orderWorkspace: "Буйрутма жана каралама",
    acceptedOrder: "Кабыл алынган",
    orderDraft: "Каралама — кабыл алына элек",
    noOrder: "Кабыл алынган топтомдор жок",
    noDraft: "Каралама бош",
    draftSaved: "Каралама бул түзмөктө сакталды",
    draftSaving: "Каралама сакталууда…",
    printDisconnected:
      "Басып чыгаруу туташтырылган эмес. Ашкана тапшырмалары кезекте сакталат.",
    printPending: "Басууну күтүүдө — принтер туташкан эмес",
    printNotRequired: "Басып чыгаруу талап кылынбайт",
    searchDish: "Тамак издөө",
    chooseCategory: "Категория",
    allCategories: "Бардык категориялар",
    addDish: "Кошуу",
    editLine: "Сапты өзгөртүү",
    removeLine: "Сапты өчүрүү",
    saveLine: "Сапты сактоо",
    lineComment: "Комментарий (300 белгиге чейин)",
    lineQuantity: "Саны",
    lineVariant: "Өлчөмү",
    lineEditHint:
      "Бул форманын өзгөртүүлөрү «Сапты сактоо» басылгандан кийин сакталат.",
    clearOrderDraft: "Караламаны тазалоо",
    clearOrderConfirm: "Караламанын бардык саптарын өчүрөсүзбү?",
    checkBatch: "Текшерүү жана жөнөтүү",
    acceptBatch: "Топтомду кабыл алуу",
    batchPreview: "Топтомду ырастоо",
    batchAccepted: "Топтом кабыл алынды",
    batchLabel: "Топтом",
    draftUnknown:
      "Жөнөтүүнүн жыйынтыгы белгисиз. Каралама бекитилген; баштапкы жөнөтүүнү текшериңиз.",
    retryBatch: "Баштапкы жөнөтүүнү текшерүү",
    orderDiscount: "Туруктуу арзандатуу",
    setOrderDiscount: "Арзандатууну сактоо",
    confirmDiscount: "Арзандатууну өзгөртүүнү ырастоо",
    orderSubtotal: "Товарлар",
    orderTotal: "Ырасталган жалпы сумма",
    newGoods: "Жаңы товарлар",
    newOrderTotal: "Кошкондон кийинки жалпы сумма",
    estimatedDraft: "Жаңы товарлардын болжолдуу суммасы",
    menuChangedOrder:
      "Менюнун редакциясы өзгөрдү. Төмөндөгү бааларды жана курамды текшериңиз; ырастоосуз топтом кабыл алынбайт.",
    conditionsChanged:
      "Шарттар өзгөрдү. Топтом кабыл алынган жок; караламаны кайра текшерип ырастаңыз.",
    moreBatches: "Кийинки топтомдор",
    orderBack: "Столдор тизмесине",
    submitBatchPermission: "TABLE топтомдорун жөнөтүү",
    discountPermission: "Буйрутманын туруктуу арзандатуусу",
    previewOnly:
      "Бул шарттарды ырастоо. Топтом жана ашкана тапшырмалары кабыл алууда сакталат.",
    draftUnavailable: "Баруу жабылган. Каралама сакталган, жөнөтүүгө болбойт.",
    closeDraftWarning:
      "Баруунун жергиликтүү караламасы бар. Барууну жабасызбы? Жабылгандан кийин каралама жөнөтүлбөйт жана жаңы барууга көчүрүлбөйт.",
    frozenEditing: "Адегенде баштапкы жөнөтүүнүн жыйынтыгын тактаңыз.",
    discardLine: "Форма сакталган жок. Жабуу керекпи?",
    kitchenSnapshot: "Ашкана тапшырмасынын курамы",
    currentOrderTotal: "Учурдагы ырасталган жалпы сумма",
  });
  Object.assign(errors, {
    CONFIRMATION_STALE: [ru.conditionsChanged, ky.conditionsChanged],
    DRAFT_FROZEN: [ru.frozenEditing, ky.frozenEditing],
    INVALID_COMMENT: [
      "Комментарий должен содержать до 300 символов без управляющих команд.",
      "Комментарий 300 белгиден ашпоого жана башкаруу буйруктарын камтыбоого тийиш.",
    ],
    DRAFT_ALREADY_ACCEPTED: [
      "Этот черновик уже принят. Обновите заказ.",
      "Бул каралама кабыл алынган. Буйрутманы жаңыртыңыз.",
    ],
    DRAFT_REVISION_CONFLICT: [
      "Черновик изменился. Обновите экран.",
      "Каралама өзгөрдү. Экранды жаңыртыңыз.",
    ],
  });
}
function orderName(item) {
  return item.translations?.[lang] || item.name;
}
function orderSelectionLabel(item, line) {
  const row = item?.combinationPrices?.find(
    (c) =>
      c.variantId === line.variantId &&
      c.optionIds.length === line.modifierIds.length &&
      c.optionIds.every((id) => line.modifierIds.includes(id)),
  );
  return (
    row?.translations?.[lang] ||
    [
      item?.variants.find((v) => v.id === line.variantId)?.name,
      ...(item?.groups
        .flatMap((g) => g.options)
        .filter((o) => line.modifierIds.includes(o.id))
        .map((o) => o.name) ?? []),
    ]
      .filter(Boolean)
      .join(" · ")
  );
}
function orderSetBlocker(item, catalog, availability = {}) {
  if (item?.kind !== "SET") return null;
  for (const c of item.components ?? []) {
    const child = catalog?.items.find((i) => i.id === c.itemId);
    if (
      !child ||
      child.kind === "SET" ||
      child.isPackaging ||
      orderUnitPrice(child, c.variantId, c.modifierIds, availability) === null
    )
      return child?.name ?? c.itemId;
    const row = child.combinationPrices?.find(
      (r) =>
        r.variantId === c.variantId &&
        r.optionIds.length === c.modifierIds.length &&
        r.optionIds.every((id) => c.modifierIds.includes(id)),
    );
    if (child.pricingMode === "MATRIX" && row?.id !== c.combinationId)
      return child.name;
  }
  return item.components?.length
    ? null
    : lang === "ky"
      ? "Курамы бош"
      : "Пустой состав";
}
function orderAvailabilityReason(item, availability = {}) {
  const stopped = row => availability[row.id]?.available === false;
  const available = row => availability[row.id]?.available ?? row.available;
  const words = lang === 'ky'
    ? {stop:'Бул тамак стоп-листте',menu:'Менюда жеткиликсиз',variantsStop:'Бул тамактын бардык өлчөмдөрү стоп-листте',variantsMenu:'Бул тамактын бардык өлчөмдөрү менюда жеткиликсиз',variantsMixed:'Өлчөмдөр стоп-листте же менюда өчүрүлгөн'}
    : {stop:'Это блюдо в стоп-листе',menu:'Недоступно в меню',variantsStop:'Все варианты блюда в стоп-листе',variantsMenu:'Все варианты блюда недоступны в меню',variantsMixed:'Варианты в стоп-листе или отключены в меню'};
  if (stopped(item)) return words.stop;
  if (!available(item)) return words.menu;
  if (item.variants.length && !item.variants.some(available)) {
    if (item.variants.every(stopped)) return words.variantsStop;
    if (item.variants.every(row => !row.available && availability[row.id]?.available !== true && !stopped(row))) return words.variantsMenu;
    return words.variantsMixed;
  }
  return null;
}
function orderSetContents(parent, item, catalog, quantity = 1) {
  if (item?.kind !== "SET") return;
  const box = el("details", undefined, { className: "set-contents" });
  box.append(el("summary", lang === "ky" ? "Сеттин курамы" : "Состав сета"));
  for (const c of item.components ?? []) {
    const child = catalog?.items.find((i) => i.id === c.itemId);
    box.append(
      el(
        "p",
        `${c.quantity * quantity} × ${child ? orderName(child) : c.itemId} · ${child ? orderSelectionLabel(child, c) : ""}`,
      ),
    );
  }
  parent.append(box);
}
function orderUnitPrice(
  item,
  variantId,
  modifierIds,
  availability = {},
  catalog = null,
) {
  if (
    !item ||
    item.archived ||
    !(availability[item.id]?.available ?? item.available)
  )
    return null;
  if (item.kind === "SET")
    return catalog && !orderSetBlocker(item, catalog, availability)
      ? item.price
      : null;
  const selectedVariant = item.variants.find((v) => v.id === variantId),
    selectedOptions = item.groups
      .flatMap((g) => g.options)
      .filter((o) => modifierIds.includes(o.id));
  if (
    (item.variants.length
      ? !selectedVariant || !(availability[selectedVariant.id]?.available ?? selectedVariant.available)
      : variantId !== null) ||
    new Set(modifierIds).size !== modifierIds.length ||
    selectedOptions.length !== modifierIds.length ||
    selectedOptions.some(
      (o) => !(availability[o.id]?.available ?? o.available),
    ) ||
    item.groups.some((g) => {
      const n = g.options.filter((o) => modifierIds.includes(o.id)).length;
      return n < g.min || n > g.max;
    })
  )
    return null;
  if (item.pricingMode === "MATRIX") {
    const variant = item.variants.find((v) => v.id === variantId);
    if (
      !(availability[item.id]?.available ?? item.available) ||
      (item.variants.length && (!variant || !(availability[variant.id]?.available ?? variant.available))) ||
      item.groups.some(
        (g) =>
          !g.options.some(
            (o) =>
              modifierIds.includes(o.id) &&
              (availability[o.id]?.available ?? o.available),
          ),
      )
    )
      return null;
    const row = item.combinationPrices?.find(
      (c) =>
        c.variantId === variantId &&
        c.optionIds.length === modifierIds.length &&
        c.optionIds.every((id) => modifierIds.includes(id)),
    );
    return row && (availability[row.id]?.available ?? row.available)
      ? row.price
      : null;
  }
  const variant = item.variants.find((v) => v.id === variantId),
    options = item.groups
      .flatMap((g) => g.options)
      .filter((o) => modifierIds.includes(o.id));
  return (
    (variant?.price ?? item.price ?? 0) +
    options.reduce((s, o) => s + o.price, 0)
  );
}
function orderSnapshotSelection(line) {
  return line.combination
    ? orderName(line.combination)
    : [
        line.variant ? orderName(line.variant) : "",
        ...(line.modifiers ?? []).map(orderName),
      ]
        .filter(Boolean)
        .join(" · ");
}
function orderLines(parent, lines) {
  for (const line of lines) {
    const row = el("div", undefined, { className: "order-line" });
    row.append(
      el(
        "strong",
        orderName(line) + " × " + line.quantity + " · " + cents(line.total),
      ),
    );
    if (line.combination) row.append(el("p", orderName(line.combination)));
    else {
      if (line.variant) row.append(el("p", orderName(line.variant)));
      if (line.modifiers?.length)
        row.append(el("p", line.modifiers.map(orderName).join(", ")));
    }
    for (const component of line.components ?? []) {
      row.append(
        el(
          "p",
          `${component.quantity * line.quantity} × ${orderName(component)}${orderSnapshotSelection(component) ? " · " + orderSnapshotSelection(component) : ""}`,
          { className: "set-component" },
        ),
      );
    }
    if (line.comment)
      row.append(el("p", line.comment, { className: "order-comment" }));
    parent.append(row);
  }
}
function orderTotals(parent, value, key = "orderTotal") {
  parent.append(
    el("p", t("orderSubtotal") + ": " + cents(value.subtotal)),
    el("p", t("orderDiscount") + ": " + cents(value.discount)),
  );
  for (const fee of value.fees)
    parent.append(
      el("p", fee.name + " (" + cents(fee.rate) + "%): " + cents(fee.amount)),
    );
  parent.append(el("strong", t(key) + ": " + cents(value.total)));
}
async function saveOrderDraft(sessionId, draft, update) {
  const quiet = isCashView("fastSales");
  if (!quiet) message(t("draftSaving"));
  const saved = await api("localDraftSave", {
    sessionId,
    expectedRevision: draft.revision,
    draft: { ...draft, ...update },
  });
  message();
  if (!quiet) toast("success", t("draftSaved"));
  return saved;
}
async function orderView() {
  const sessionId = orderSession;
  if (!sessionId) return;
  let offline = false,
    visit,
    accepted,
    menu;
  try {
    me = await api("me");
    visit = await api("visitGet", { id: sessionId });
    accepted = await api("orderGet", { sessionId });
    menu = await api("menu");
    await api("draftContext", { sessionId });
    orderCache = {
      sessionId,
      actorId: me.id,
      visit,
      accepted,
      menu,
      history: null,
      jobs: [],
    };
  } catch (error) {
    if (
      error.message !== "SERVER_UNAVAILABLE" ||
      orderCache?.sessionId !== sessionId ||
      orderCache.actorId !== me?.id
    )
      throw error;
    offline = true;
    ({ visit, accepted, menu } = orderCache);
  }
  let draft = await api("localDraftRead", { sessionId });
  draft ??= {
    id: crypto.randomUUID(),
    revision: 0,
    lines: [],
    discount: accepted?.discount ?? 0,
    menuRevision: menu.revision,
    frozen: null,
  };
  if (
    accepted &&
    draft.discount !== accepted.discount &&
    !draft.frozen &&
    me.permissions.includes("table.batch.submit")
  )
    draft = await saveOrderDraft(sessionId, draft, {
      discount: accepted.discount,
    });
  const section = shell(t("orderWorkspace") + " · " + visit.tableName);
  section.append(
    el(
      "p",
      visit.zoneName +
        " · " +
        t("openedBy") +
        ": " +
        visit.openedBy.name +
        " · " +
        t("responsible") +
        ": " +
        (visit.responsibleWaiter?.name ?? t("noWaiter")),
    ),
    el("p", t("printDisconnected"), { className: "print-warning" }),
  );
  button(section, "orderBack", async () => {
    screen = "tables";
    orderSession = null;
    await render();
  });
  if (offline)
    section.append(el("p", t("connection"), { className: "print-warning" }));
  const columns = el("div", undefined, { className: "order-columns" }),
    history = el("div", undefined, { className: "order-history" }),
    editor = el("div", undefined, { className: "order-editor" });
  history.append(el("h2", t("acceptedOrder")));
  if (!accepted) history.append(el("p", t("noOrder")));
  else orderTotals(history, accepted);
  let cursor = 0;
  async function more() {
    const page = offline
      ? (orderCache.history ?? { batches: [], next: null })
      : await api("orderHistory", { sessionId, after: cursor });
    if (cursor === 0 && !offline) orderCache.history = page;
    for (const batch of page.batches) {
      const card = el("article", undefined, { className: "card" });
      card.append(
        el(
          "h3",
          t("batchLabel") + " " + batch.sequence + " · " + batch.sender.name,
        ),
        el(
          "p",
          new Date(batch.submittedAt).toLocaleString(
            lang === "ky" ? "ky-KG" : "ru-RU",
            { timeZone: "Asia/Bishkek" },
          ),
        ),
      );
      orderLines(card, batch.lines);
      card.append(
        el("p", t("newGoods") + ": " + cents(batch.subtotal)),
        el(
          "p",
          batch.kitchenJobs.length
            ? serverSchema >= 10
              ? [
                  ...new Set(
                    batch.kitchenJobs.map((j) => effectivePrintText(j.status)),
                  ),
                ].join(" · ")
              : t("printPending")
            : t("printNotRequired"),
        ),
      );
      history.append(card);
    }
    moreButton.hidden = page.next === null;
    cursor = page.next ?? cursor;
  }
  const moreButton = button(history, "moreBatches", more);
  await more();
  if (accepted && serverSchema >= 7 && !offline)
    await financeOrderActions(history, accepted.id);
  if (accepted) {
    const jobs = offline
      ? orderCache.jobs
      : await api("kitchenJobs", { sessionId });
    if (!offline) orderCache.jobs = jobs;
    if (jobs.length) {
      const details = el("details");
      details.append(el("summary", t("kitchenSnapshot")));
      for (const job of jobs) {
        details.append(
          el(
            "p",
            serverSchema >= 10
              ? effectivePrintText(job.status)
              : t("printPending"),
          ),
        );
        orderLines(details, job.payload.lines);
      }
      history.append(details);
    }
  }
  editor.append(el("h2", t("orderDraft")));
  if (visit.status !== "OPEN") editor.append(el("p", t("draftUnavailable")));
  if (draft.frozen) {
    editor.append(el("p", t("draftUnknown")));
    button(
      editor,
      "retryBatch",
      async () => {
        const pending = await api("pending"),
          record = pending.find(
            (p) =>
              p.action === "batchSubmit" &&
              p.payload.sessionId === sessionId &&
              p.payload.draftId === draft.id,
          );
        if (!record) throw new Error("DRAFT_RECOVERY_REQUIRED");
        await api("retryPending", { key: record.key });
        await orderView();
        message();
        toast("success", t("batchAccepted"));
      },
      true,
    );
  }
  if (!draft.lines.length) editor.append(el("p", t("noDraft")));
  let estimate = 0;
  for (const line of draft.lines) {
    const item = menu.catalog?.items.find((i) => i.id === line.itemId),
      card = el("div", undefined, { className: "card" });
    card.append(
      el(
        "strong",
        (item ? orderName(item) : line.itemId) + " × " + line.quantity,
      ),
    );
    if (line.comment)
      card.append(el("p", line.comment, { className: "order-comment" }));
    const variant = item?.variants.find((v) => v.id === line.variantId),
      options =
        item?.groups
          .flatMap((g) => g.options)
          .filter((o) => line.modifierIds.includes(o.id)) ?? [];
    card.append(el("p", orderSelectionLabel(item, line)));
    orderSetContents(card, item, menu.catalog, line.quantity);
    const unit = orderUnitPrice(
      item,
      line.variantId,
      line.modifierIds,
      menu.availability,
      menu.catalog,
    );
    if (unit === null)
      card.append(
        el("p", t("conditionsChanged"), { className: "print-warning" }),
      );
    else estimate += unit * line.quantity;
    if (
      !draft.frozen &&
      visit.status === "OPEN" &&
      me.permissions.includes("table.batch.submit")
    ) {
      if (item)
        button(card, "editLine", () =>
          editOrderLine(sessionId, draft, menu, item, line),
        );
      button(card, "removeLine", async () => {
        await saveOrderDraft(sessionId, draft, {
          lines: draft.lines.filter((l) => l.lineId !== line.lineId),
        });
        await orderView();
      });
    }
    editor.append(card);
  }
  editor.append(el("p", t("estimatedDraft") + ": " + cents(estimate)));
  if (!draft.frozen && draft.revision > 0)
    editor.append(el("p", t("draftSaved"), { className: "muted" }));
  const writable = !draft.frozen && visit.status === "OPEN";
  if (writable && me.permissions.includes("order.discount.set")) {
    const form = el("form");
    const value = field(
        form,
        "orderDiscount",
        cents(accepted?.discount ?? draft.discount),
      ),
      submit = el("button", t("setOrderDiscount"), { type: "submit" });
    form.append(submit);
    form.onsubmit = (e) => {
      e.preventDefault();
      run(async () => {
        const amount = parseCents(value.value);
        let confirmation =
          t("confirmDiscount") +
          ": " +
          cents(accepted?.discount ?? draft.discount) +
          " → " +
          cents(amount);
        if (accepted) {
          if (amount > accepted.subtotal) throw new Error("INVALID_DISCOUNT");
          const base = BigInt(accepted.subtotal - amount),
            fees = accepted.fees.map((f) => ({
              ...f,
              amount: Number((base * BigInt(f.rate) + 5000n) / 10000n),
            })),
            total = Number(base) + fees.reduce((s, f) => s + f.amount, 0);
          confirmation +=
            " · " +
            t("orderTotal") +
            ": " +
            cents(accepted.total) +
            " → " +
            cents(total) +
            " · " +
            fees.map((f) => f.name + ": " + cents(f.amount)).join(", ");
        }
        if (!(await confirmAction(confirmation))) return;
        if (accepted)
          await api("orderDiscount", {
            orderId: accepted.id,
            expectedRevision: accepted.revision,
            amount,
          });
        else await saveOrderDraft(sessionId, draft, { discount: amount });
        await orderView();
      }, submit);
    };
    editor.append(form);
  }
  if (writable && me.permissions.includes("table.batch.submit")) {
    if (draft.lines.length) {
      button(editor, "clearOrderDraft", async () => {
        if (!(await confirmAction(t("clearOrderConfirm")))) return;
        await saveOrderDraft(sessionId, draft, {
          lines: [],
          discount: accepted?.discount ?? 0,
        });
        await orderView();
      });
      button(
        editor,
        "checkBatch",
        () => prepareOrderBatch(sessionId, draft),
        true,
      );
    }
    const search = field(editor, "searchDish", "", "search", false),
      label = el("label", t("chooseCategory")),
      categories = el("select");
    categories.setAttribute("aria-label", t("chooseCategory"));
    categories.append(el("option", t("allCategories"), { value: "" }));
    for (const c of menu.catalog?.categories.filter((c) => !c.archived) ?? [])
      categories.append(el("option", orderName(c), { value: c.id }));
    label.append(categories);
    editor.append(label);
    const products = el("div", undefined, { className: "product-list" });
    editor.append(products);
    function draw() {
      products.replaceChildren();
      for (const item of menu.catalog?.items.filter(
        (i) =>
          !i.archived &&
          menu.catalog.categories.some(
            (c) => c.id === i.categoryId && !c.archived,
          ) &&
          (!categories.value || i.categoryId === categories.value) &&
          orderName(i)
            .toLocaleLowerCase()
            .includes(search.value.toLocaleLowerCase()),
      ) ?? []) {
        const row = el("div", undefined, { className: "card" });
        row.append(el("strong", orderName(item)));
        const b = button(row, "addDish", () =>
          editOrderLine(sessionId, draft, menu, item),
        );
        const blocked = orderSetBlocker(item, menu.catalog, menu.availability);
        const availabilityReason = orderAvailabilityReason(item, menu.availability);
        b.disabled =
          !!availabilityReason ||
          !!blocked;
        if (availabilityReason) row.append(el('small', availabilityReason, { className: 'order-catalog-availability' }));
        if (blocked)
          row.append(
            el(
              "p",
              (lang === "ky" ? "Жеткиликсиз: " : "Нет в наличии: ") + blocked,
            ),
          );
        orderSetContents(row, item, menu.catalog);
        if (b.disabled) row.append(el("p", t("tableUnavailable")));
        products.append(row);
      }
    }
    search.oninput = draw;
    categories.onchange = draw;
    draw();
  }
  columns.append(history, editor);
  section.append(columns);
  button(section, "refresh", orderView);
}
async function editOrderLine(sessionId, draft, menu, item, existing) {
  const dialog = el("dialog"),
    form = el("form");
  dialog.append(el("h2", orderName(item)), el("p", t("lineEditHint")));
  orderSetContents(dialog, item, menu.catalog, existing?.quantity ?? 1);
  const quantity = field(
    form,
    "lineQuantity",
    existing?.quantity ?? 1,
    "number",
  );
  quantity.min = 1;
  quantity.max =
    item.kind === "SET"
      ? Math.floor(9999 / Math.max(...item.components.map((c) => c.quantity)))
      : 9999;
  quantity.step = 1;
  let variant;
  if (item.variants.length) {
    const label = el("label", t("lineVariant"));
    variant = el("select");
    variant.setAttribute("aria-label", t("lineVariant"));
    if (item.pricingMode === "MATRIX")
      variant.append(
        el("option", lang === "ky" ? "Өлчөмдү тандаңыз" : "Выберите размер", {
          value: "",
        }),
      );
    for (const v of item.variants)
      variant.append(
        el(
          "option",
          item.pricingMode === "MATRIX"
            ? v.name
            : v.name + " · " + cents(v.price),
          {
            value: v.id,
            disabled: !(menu.availability[v.id]?.available ?? v.available),
            selected: v.id === existing?.variantId,
          },
        ),
      );
    label.append(variant);
    form.append(label);
  }
  const modifiers = [],
    matrixGroups = [];
  for (const group of item.groups) {
    if (item.pricingMode === "MATRIX") {
      const label = el(
          "label",
          group.name + " · " + (lang === "ky" ? "милдеттүү" : "обязательно"),
        ),
        select = el("select");
      select.setAttribute("aria-label", group.name);
      select.append(
        el(
          "option",
          lang === "ky" ? "Вариантты тандаңыз" : "Выберите вариант",
          { value: "" },
        ),
      );
      for (const option of group.options)
        select.append(
          el("option", option.name, {
            value: option.id,
            disabled: !(
              menu.availability[option.id]?.available ?? option.available
            ),
            selected: existing?.modifierIds.includes(option.id),
          }),
        );
      label.append(select);
      form.append(label);
      matrixGroups.push(select);
      continue;
    }
    const set = el("fieldset");
    set.append(
      el("legend", group.name + " (" + group.min + "–" + group.max + ")"),
    );
    for (const option of group.options) {
      const label = el("label"),
        input = el("input", undefined, {
          type: "checkbox",
          checked: existing?.modifierIds.includes(option.id) ?? false,
          disabled:
            !(menu.availability[option.id]?.available ?? option.available) &&
            !existing?.modifierIds.includes(option.id),
        });
      input.onchange = () => {
        if (
          !(menu.availability[option.id]?.available ?? option.available) &&
          !input.checked
        )
          input.disabled = true;
      };
      label.append(
        input,
        document.createTextNode(option.name + " · " + cents(option.price)),
      );
      set.append(label);
      modifiers.push({ group, option, input });
    }
    form.append(set);
  }
  const label = el("label", t("lineComment")),
    comment = el("textarea", undefined, { value: existing?.comment ?? "" });
  comment.setAttribute("aria-label", t("lineComment"));
  label.append(comment);
  form.append(label);
  const priceHint = el("p", "", { className: "muted" });
  if (item.pricingMode === "MATRIX") form.append(priceHint);
  const selectedIds = () =>
    item.pricingMode === "MATRIX"
      ? matrixGroups.map((s) => s.value)
      : modifiers.filter((m) => m.input.checked).map((m) => m.option.id);
  const preview = () => {
    if (item.pricingMode !== "MATRIX") return;
    const ids = selectedIds(),
      price =
        (variant && !variant.value) || ids.some((id) => !id)
          ? null
          : orderUnitPrice(
              item,
              variant?.value ?? null,
              ids,
              menu.availability,
              menu.catalog,
            );
    priceHint.textContent =
      price === null
        ? "Выберите доступное сочетание"
        : `Цена: ${cents(price)} сом`;
  };
  variant?.addEventListener("change", preview);
  for (const select of matrixGroups) select.addEventListener("change", preview);
  preview();
  const submit = el("button", t("saveLine"), {
    type: "submit",
    className: "primary",
  });
  form.append(submit);
  dialog.append(form);
  let changed = false;
  form.oninput = () => {
    changed = true;
  };
  const cancel = async () => {
    if (changed && !(await confirmAction(t("discardLine")))) return;
    dialog.close();
  };
  button(dialog, "cancel", cancel);
  dialog.oncancel = (e) => {
    e.preventDefault();
    run(cancel);
  };
  dialog.onclose = () => dialog.remove();
  document.body.append(dialog);
  dialog.showModal();
  form.onsubmit = (e) => {
    e.preventDefault();
    run(async () => {
      if (item.pricingMode !== "MATRIX")
        for (const g of item.groups) {
          const count = modifiers.filter(
            (m) => m.group.id === g.id && m.input.checked,
          ).length;
          if (count < g.min || count > g.max)
            throw new Error("MODIFIER_SELECTION_LIMIT");
        }
      const ids = selectedIds(),
        variantId = variant?.value || null,
        price = orderUnitPrice(
          item,
          variantId,
          ids,
          menu.availability,
          menu.catalog,
        );
      if (item.kind === "SET" && price === null)
        throw new Error("SET_COMPONENT_UNAVAILABLE");
      if (
        item.pricingMode === "MATRIX" &&
        ((variant && !variantId) || ids.some((id) => !id) || price === null)
      )
        throw new Error("COMBINATION_UNAVAILABLE");
      const line = {
        lineId: existing?.lineId ?? crypto.randomUUID(),
        itemId: item.id,
        variantId,
        modifierIds: ids,
        quantity: Number(quantity.value),
        comment: comment.value.replace(/\r\n/g, "\n").normalize("NFC"),
      };
      const lines = existing
        ? draft.lines.map((l) => (l.lineId === line.lineId ? line : l))
        : [...draft.lines, line];
      const saved = await saveOrderDraft(sessionId, draft, {
        lines,
        preview: {
          ...draft.preview,
          [line.lineId]: { name: orderName(item), unitPrice: price },
        },
        menuRevision: menu.revision,
      });
      dialog.close();
      if (screen === "counterEditor") {
        const root = $("screen");
        root.inert = true;
        try {
          if (!existing && item.containerId)
            await offerContainer(sessionId, saved, menu, item, line);
          else if (
            existing &&
            line.quantity !== existing.quantity &&
            item.containerId
          )
            await offerContainer(sessionId, saved, menu, item, line, true);
          await counterEditor();
        } finally {
          root.inert = false;
        }
      } else await orderView();
    }, submit);
  };
}
async function prepareOrderBatch(sessionId, draft) {
  if (orderBusy) return;
  orderBusy = true;
  try {
    if (!draft.revision) throw new Error("DRAFT_REVISION_CONFLICT");
    const input = () => ({
      sessionId,
      draftId: draft.id,
      draftRevision: draft.revision,
      menuRevision: draft.menuRevision,
      discount: draft.discount,
      lines: draft.lines,
    });
    let quote = await api("batchPrepare", input());
    const changed = quote.menuChanged;
    if (changed) {
      draft = await saveOrderDraft(sessionId, draft, {
        menuRevision: quote.menuRevision,
      });
      quote = await api("batchPrepare", input());
    }
    const dialog = el("dialog");
    dialog.append(
      el("h2", t("batchPreview")),
      el("p", t("previewOnly")),
      el("p", t("printDisconnected")),
    );
    if (changed)
      dialog.append(
        el("p", t("menuChangedOrder"), { className: "print-warning" }),
      );
    for (const line of quote.lines) {
      const old = draft.preview?.[line.lineId];
      if (old && old.unitPrice !== line.unitPrice)
        dialog.append(
          el(
            "p",
            old.name +
              ": " +
              cents(old.unitPrice) +
              " → " +
              cents(line.unitPrice),
            { className: "print-warning" },
          ),
        );
    }
    orderLines(dialog, quote.lines);
    dialog.append(
      el("p", t("newGoods") + ": " + cents(quote.batchSubtotal)),
      el("p", t("currentOrderTotal") + ": " + cents(quote.current?.total ?? 0)),
    );
    orderTotals(dialog, quote, "newOrderTotal");
    button(
      dialog,
      "acceptBatch",
      async () => {
        dialog.close();
        try {
          await api("batchSubmit", {
            ...input(),
            orderRevision: quote.orderRevision,
            confirmationHash: quote.confirmationHash,
          });
          await orderView();
          message();
          toast("success", t("batchAccepted"));
        } catch (error) {
          await orderView();
          throw error;
        }
      },
      true,
    );
    button(dialog, "cancel", () => dialog.close());
    dialog.onclose = () => dialog.remove();
    document.body.append(dialog);
    dialog.showModal();
    const heading = dialog.querySelector("h2");
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
    dialog.scrollTop = 0;
  } finally {
    orderBusy = false;
  }
}
setInterval(async () => {
  if (
    !me ||
    screen !== "order" ||
    !orderSession ||
    orderRefresh ||
    document.hidden
  )
    return;
  orderRefresh = true;
  try {
    const current = await api("me");
    me = current;
    const visit = await api("visitGet", { id: orderSession });
    await api("draftContext", { sessionId: orderSession });
    const snapshot = await api("orderGet", { sessionId: orderSession });
    if (
      (snapshot?.revision !== orderCache?.accepted?.revision ||
        visit.status !== orderCache?.visit.status) &&
      !document.querySelector("dialog[open]") &&
      !document.activeElement?.matches("input,textarea,select")
    )
      await orderView();
  } catch (error) {
    if (error.message === "SERVER_UNAVAILABLE") {
      message(t("connection"));
      return;
    }
    document.querySelectorAll("dialog").forEach((d) => d.close());
    $("screen").replaceChildren();
    handleError(error);
  } finally {
    orderRefresh = false;
  }
}, 5000);
