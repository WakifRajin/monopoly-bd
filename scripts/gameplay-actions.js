// ═══════════════════════════════════════════════
//  DICE & MOVEMENT
// ═══════════════════════════════════════════════
async function rollDice() {
  if (!requireTurnControl()) return;
  const p = getLivePlayer(curPlayer());
  if (!p || p.bankrupt) return;
  if (G.phase !== "roll" || MOVE_FX.active) return;

  const d1 = rand(1, 6),
    d2 = rand(1, 6);
  const doubles = d1 === d2;
  G.dice = [d1, d2];
  G.lastDoubles = doubles;
  playSfx("dice");

  // Animate dice
  ["die1", "die2"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.classList.add("rolling");
      setTimeout(() => el.classList.remove("rolling"), 400);
    }
  });
  setTimeout(() => {
    const die1 = document.getElementById("die1");
    const die2 = document.getElementById("die2");
    if (die1) die1.dataset.v = d1;
    if (die2) die2.dataset.v = d2;
  }, 200);

  addLog(
    `${p.name} rolled ${d1}+${d2}=${d1 + d2}${doubles ? " (DOUBLES! 🎲🎲)" : ""}`,
  );

  if (p.inJail) {
    await handleJailRoll(p.id, d1, d2, doubles);
    return;
  }

  if (doubles) {
    p.doublesCount++;
    if (p.doublesCount >= 3) {
      addLog(`${p.name} rolled 3 doubles in a row — Go to Jail!`, "danger");
      sendToJail(p);
      G.phase = "action";
      renderAll();
      updateActionButtons();
      return;
    }
  } else {
    p.doublesCount = 0;
  }

  await movePlayer(p.id, d1 + d2, doubles);
}

async function handleJailRoll(player, d1, d2, doubles) {
  const p = getLivePlayer(player);
  if (!p || p.bankrupt) return;
  const bailAmount = getThemeJailBail(G.boardThemeId || selectedThemeId);
  if (doubles) {
    p.inJail = false;
    p.jailTurns = 0;
    p.doublesCount = 0;
    addLog(`${p.name} rolled doubles — released from jail!`, "success");
    await movePlayer(p.id, d1 + d2, false);
  } else {
    p.jailTurns++;
    if (p.jailTurns >= 3) {
      // Force pay
      addLog(
        `${p.name} must pay ${fmtCurrency(bailAmount)} to leave jail after 3 turns.`,
        "danger",
      );
      const paid = chargeMoney(p, bailAmount);
      if (!paid) {
        G.phase = "end";
        renderAll();
        updateActionButtons();
        return;
      }
      if (p.bankrupt) {
        G.phase = "end";
        renderAll();
        updateActionButtons();
        checkBankruptcy();
        return;
      }
      p.inJail = false;
      p.jailTurns = 0;
      await movePlayer(p.id, d1 + d2, false);
    } else {
      addLog(`${p.name} failed to roll doubles. Jail turn ${p.jailTurns}/3.`);
      G.phase = "end";
      renderAll();
      updateActionButtons();
    }
  }
}

async function movePlayer(player, steps, rolledDoubles) {
  const p = getLivePlayer(player);
  if (!p || p.bankrupt || !Number.isInteger(steps) || steps <= 0) return;
  const playerId = p.id;
  const oldPos = p.pos;
  const newPos = (p.pos + steps) % 40;
  const goSalary = getThemeGoSalary(G.boardThemeId || selectedThemeId);
  let goPaid = false;
  // Pass GO
  if (newPos < oldPos) {
    p.money += goSalary;
    goPaid = true;
    addLog(
      `${p.name} passed GO! Collected ${fmtCurrency(goSalary)}`,
      "success",
    );
  }

  G.phase = "action";
  const moved = await animatePlayerStepMovement(playerId, steps);
  if (!moved) return;
  MOVE_FX.active = true;
  MOVE_FX.playerId = playerId;
  updateActionButtons();
  try {
    const livePlayer = getLivePlayer(playerId);
    if (!livePlayer || livePlayer.bankrupt) return;
    livePlayer.pos = newPos;
    renderAll();
    await waitMs(160);
    landOn(livePlayer, rolledDoubles, { goPaid });
  } finally {
    MOVE_FX.active = false;
    MOVE_FX.playerId = null;
    updateActionButtons();
  }
}

async function movePlayerTo(player, target, collectGo = true) {
  const p = getLivePlayer(player);
  if (!p || p.bankrupt) return;
  const playerId = p.id;
  const oldPos = p.pos;
  const goSalary = getThemeGoSalary(G.boardThemeId || selectedThemeId);
  const stepsForward = (target - oldPos + 40) % 40;
  let goPaid = false;
  if (collectGo && stepsForward > 0 && target < oldPos) {
    p.money += goSalary;
    goPaid = true;
    addLog(
      `${p.name} passed GO! Collected ${fmtCurrency(goSalary)}`,
      "success",
    );
  }

  if (stepsForward > 0 && stepsForward <= 12) {
    const moved = await animatePlayerStepMovement(playerId, stepsForward);
    if (!moved) return;
  } else {
    const live = getLivePlayer(playerId);
    if (!live || live.bankrupt) return;
    live.pos = target;
    renderMarkers();
    if (stepsForward > 0) pulseBoardSpace(target, "step-arrive", 360);
  }

  MOVE_FX.active = true;
  MOVE_FX.playerId = playerId;
  updateActionButtons();
  try {
    const livePlayer = getLivePlayer(playerId);
    if (!livePlayer || livePlayer.bankrupt) return;
    livePlayer.pos = target;
    renderAll();
    await waitMs(140);
    landOn(livePlayer, false, { goPaid });
  } finally {
    MOVE_FX.active = false;
    MOVE_FX.playerId = null;
    updateActionButtons();
  }
}

function landOn(p, rolledDoubles, opts = null) {
  const playerId = Number(p?.id);
  if (
    !Number.isInteger(playerId) ||
    playerId < 0 ||
    playerId >= G.players.length
  )
    return;
  if (Number(G.currentPlayerIdx) !== playerId) return;

  const sp = SPACES[p.pos];
  const goSalary = getThemeGoSalary(G.boardThemeId || selectedThemeId);
  const goPaid = !!(opts && opts.goPaid);
  addLog(`${p.name} landed on ${sp.name}`);

  if (sp.type === "go") {
    if (!goPaid) {
      addLog(
        `${p.name} landed on GO — collect ${fmtCurrency(goSalary)}!`,
        "success",
      );
      p.money += goSalary;
    }
    G.phase = "end";
  } else if (sp.type === "jail") {
    addLog(`${p.name} is just visiting jail.`);
    G.phase = "end";
  } else if (sp.type === "parking") {
    addLog(`${p.name} is just visiting free parking.`);
    G.phase = "end";
  } else if (sp.type === "gotojail") {
    sendToJail(p);
    G.phase = "end";
  } else if (sp.type === "chance") {
    drawCard("chance", p);
    return;
  } else if (sp.type === "community") {
    drawCard("community", p);
    return;
  } else if (sp.type === "tax") {
    addLog(`${p.name} pays ${fmtCurrency(sp.amount)} tax.`, "danger");
    playSfx("tax");
    chargeMoney(p, sp.amount, null, true);
    G.phase = "end";
  } else if (
    sp.type === "property" ||
    sp.type === "railroad" ||
    sp.type === "utility"
  ) {
    const prop = G.properties[p.pos];
    if (!prop) {
      G.phase = "end";
    } else if (prop.mortgaged) {
      addLog(`${sp.name} is mortgaged — no rent.`);
      G.phase = "end";
    } else if (prop.owner === null) {
      // Can buy
      G.pendingBuy = p.pos;
      promptBuy(p, sp);
      renderAll();
      updateActionButtons();
      return;
    } else if (prop.owner === p.id) {
      addLog(`${p.name} owns ${sp.name}.`);
      G.phase = "end";
    } else {
      // Pay rent
      const rent = calcRent(sp, prop);
      const owner = G.players[prop.owner];
      addLog(
        `${p.name} pays ${fmtCurrency(rent)} rent to ${owner.name} for ${sp.name}.`,
        "danger",
      );
      playSfx("rent");
      showRentModal(p, owner, sp.name, rent);
      chargeMoney(p, rent, owner);
      G.phase = "end";
    }
  }

  // If rolled doubles and not in jail, get another roll
  if (rolledDoubles && !p.inJail && !G.gameOver) {
    addLog(`${p.name} rolled doubles — roll again!`, "success");
    G.phase = "roll";
  }

  renderAll();
  updateActionButtons();
  checkBankruptcy();
}

// ═══════════════════════════════════════════════
//  RENT CALCULATION
// ═══════════════════════════════════════════════
function countOwnedSpacesByType(ownerId, type) {
  if (!Number.isInteger(ownerId) || !type) return 0;
  let count = 0;
  for (let id = 0; id < SPACES.length; id++) {
    const space = SPACES[id];
    const prop = G.properties[id];
    if (!space || !prop || space.type !== type) continue;
    if (prop.owner === null || prop.owner === undefined) continue;
    const propOwner = Number(prop.owner);
    if (Number.isInteger(propOwner) && propOwner === ownerId) count++;
  }
  return count;
}

function currentDiceTotalForUtilityRent() {
  const rawDie1 = Number(G?.dice?.[0]);
  const rawDie2 = Number(G?.dice?.[1]);
  if (!Number.isFinite(rawDie1) || !Number.isFinite(rawDie2)) return 0;
  const die1 = Math.max(1, Math.min(6, Math.trunc(rawDie1)));
  const die2 = Math.max(1, Math.min(6, Math.trunc(rawDie2)));
  return die1 + die2;
}

function calcRent(sp, prop) {
  if (prop.mortgaged) return 0;
  if (sp.type === "railroad") {
    if (prop.owner === null || prop.owner === undefined) return 0;
    const ownerId = Number(prop.owner);
    if (
      !Number.isInteger(ownerId) ||
      ownerId < 0 ||
      ownerId >= G.players.length
    )
      return 0;
    const rrCount = Math.max(1, countOwnedSpacesByType(ownerId, "railroad"));
    const rentIdx = Math.min(sp.rent.length - 1, rrCount - 1);
    return Number(sp.rent[rentIdx]) || 0;
  }
  if (sp.type === "utility") {
    if (prop.owner === null || prop.owner === undefined) return 0;
    const ownerId = Number(prop.owner);
    if (
      !Number.isInteger(ownerId) ||
      ownerId < 0 ||
      ownerId >= G.players.length
    )
      return 0;
    const utilCount = Math.max(1, countOwnedSpacesByType(ownerId, "utility"));
    const diceTotal = currentDiceTotalForUtilityRent();
    const utilRentCfg = getThemeUtilityRentMultipliers(
      G.boardThemeId || selectedThemeId,
    );
    if (diceTotal <= 0) return 0;
    return utilCount >= 2
      ? diceTotal * utilRentCfg.both
      : diceTotal * utilRentCfg.one;
  }
  if (prop.hotel) return sp.rent[5];
  if (prop.houses > 0) return sp.rent[prop.houses];
  // Check monopoly
  const owner = G.players[prop.owner];
  const groupIds = SPACES.filter(
    (s) => s.type === "property" && s.group === sp.group,
  ).map((s) => s.id);
  const monopoly = groupIds.every(
    (id) => G.properties[id]?.owner === prop.owner,
  );
  return monopoly ? sp.rent[0] * 2 : sp.rent[0];
}

// ═══════════════════════════════════════════════
//  CARDS
// ═══════════════════════════════════════════════
function drawCard(type, p) {
  let card;
  if (type === "chance") {
    card = G.chanceDeck[G.chanceIdx % G.chanceDeck.length];
    G.chanceIdx++;
  } else {
    card = G.communityDeck[G.communityIdx % G.communityDeck.length];
    G.communityIdx++;
  }
  const playerId = Number(p?.id);
  const drawPlayer = getLivePlayer(playerId) || p;
  const cardText = formatThemeCurrencyText(card.text);
  addLog(
    `${drawPlayer.name} drew ${type === "chance" ? "Chance" : "Community Chest"}: ${cardText}`,
  );
  playSfx("card");

  ONLINE.pendingCardResolutions =
    (Number(ONLINE.pendingCardResolutions) || 0) + 1;

  const finalizeCardResolution = async (shouldSync = true) => {
    const pending = Number(ONLINE.pendingCardResolutions) || 0;
    ONLINE.pendingCardResolutions = Math.max(0, pending - 1);
    renderAll();
    updateActionButtons();
    maybeScheduleOfflineAiTurn();

    try {
      if (shouldSync && isOnlineGame() && !ONLINE.isApplyingRemote) {
        await syncRoomState("drawCard");
      }
    } catch (err) {
      console.error(err);
    }
  };

  document.getElementById("card-icon").textContent =
    type === "chance" ? "❓" : "📦";
  document.getElementById("card-title").textContent =
    type === "chance" ? "Chance Card" : "Community Chest";
  document.getElementById("card-desc").textContent = cardText;

  const apply = async () => {
    const actor = getLivePlayer(playerId);
    if (!actor || actor.bankrupt) return;
    if (Number(G.currentPlayerIdx) !== actor.id) return;

    if (card.action === "money") {
      if (card.value > 0) {
        actor.money += card.value;
        addLog(
          `${actor.name} received ${fmtCurrency(card.value)} from a card effect.`,
          "success",
        );
        toast(`+${fmtCurrency(card.value)}`, "gold");
      } else {
        const paid = chargeMoney(actor, -card.value, null, true);
        if (paid)
          addLog(
            `${actor.name} paid ${fmtCurrency(-card.value)} due to a card effect.`,
            "danger",
          );
      }
    } else if (card.action === "goto") {
      await movePlayerTo(actor.id, card.value, card.value < actor.pos);
      return;
    } else if (card.action === "jail") {
      sendToJail(actor);
    } else if (card.action === "jailcard") {
      actor.jailFreeCards++;
      addLog(`${actor.name} got a Get Out of Jail Free card!`, "success");
    } else if (card.action === "nearest") {
      const nearest = nearestRailroad(actor.pos);
      await movePlayerTo(actor.id, nearest);
      return;
    } else if (card.action === "repairs") {
      let cost = 0;
      actor.properties.forEach((id) => {
        const pr = G.properties[id];
        if (pr.hotel) cost += card.value.hotel;
        else cost += pr.houses * card.value.house;
      });
      if (cost > 0) {
        chargeMoney(actor, cost, null, true);
        addLog(
          `${actor.name} paid ${fmtCurrency(cost)} for repairs.`,
          "danger",
        );
      }
    } else if (card.action === "birthday") {
      G.players.forEach((op, oi) => {
        if (oi !== actor.id && !op.bankrupt) {
          op.money -= card.value;
          actor.money += card.value;
        }
      });
      addLog(
        `${actor.name} collected ${fmtCurrency(card.value)} from each player for birthday!`,
        "success",
      );
    }
    G.phase = rolledDoublesThisTurn() ? "roll" : "end";
    renderAll();
    updateActionButtons();
    checkBankruptcy();
  };

  if (shouldAutoActForAi(getLivePlayer(playerId) || p)) {
    closeOverlay("card-overlay");
    apply()
      .then(() => finalizeCardResolution(true))
      .catch((err) => {
        console.error(err);
        finalizeCardResolution(false).catch((syncErr) =>
          console.error(syncErr),
        );
      });
    return;
  }

  closeOverlay("card-overlay");
  openOverlay("card-overlay");
  const cardConfirmBtn = document.querySelector("#card-overlay .btn");
  if (!cardConfirmBtn) {
    finalizeCardResolution(false).catch((err) => console.error(err));
    return;
  }
  cardConfirmBtn.onclick = async () => {
    closeOverlay("card-overlay");
    try {
      await apply();
      await finalizeCardResolution(true);
    } catch (err) {
      console.error(err);
      await finalizeCardResolution(false);
    }
  };
}

function nearestRailroad(pos) {
  const rrs = [5, 15, 25, 35];
  let nearest = rrs[0],
    minDist = 40;
  rrs.forEach((r) => {
    const dist = r > pos ? r - pos : 40 - pos + r;
    if (dist < minDist) {
      minDist = dist;
      nearest = r;
    }
  });
  return nearest;
}

// ═══════════════════════════════════════════════
//  BUY / AUCTION
// ═══════════════════════════════════════════════
function promptBuy(p, sp) {
  if (shouldAutoActForAi(p)) {
    closeOverlay("buy-overlay");
    return;
  }

  const buyBtn = document.querySelector("#buy-overlay .btn-primary");
  const auctionBtn = document.getElementById("buy-auction-btn");
  const auctionsEnabled = isAuctionSystemEnabled();

  if (p.money < sp.price) {
    if (buyBtn) buyBtn.style.display = "none";
    if (auctionBtn) auctionBtn.style.display = auctionsEnabled ? "" : "none";
    document.getElementById("buy-title").textContent = auctionsEnabled
      ? `Can't Afford — Auction!`
      : `Can't Afford`;
    document.getElementById("buy-desc").textContent = auctionsEnabled
      ? `${sp.name} costs ${fmtCurrency(sp.price)} but you only have ${fmtCurrency(p.money)}. It goes to auction.`
      : `${sp.name} costs ${fmtCurrency(sp.price)} but you only have ${fmtCurrency(p.money)}. Auctions are OFF, so this property remains unsold.`;
    openOverlay("buy-overlay");
    return;
  }

  if (buyBtn) buyBtn.style.display = "";
  if (auctionBtn) auctionBtn.style.display = auctionsEnabled ? "" : "none";
  document.getElementById("buy-title").textContent = `Buy ${sp.name}?`;
  document.getElementById("buy-desc").textContent = auctionsEnabled
    ? `Price: ${fmtCurrency(sp.price)}. You have ${fmtCurrency(p.money)}. Buy now or send to auction.`
    : `Price: ${fmtCurrency(sp.price)}. You have ${fmtCurrency(p.money)}. Auctions are OFF for this match.`;
  openOverlay("buy-overlay");
}

function confirmBuy() {
  closeOverlay("buy-overlay");
  actionBuy();
}

function actionBuy() {
  if (!requireTurnControl()) return;
  if (MOVE_FX.active) return;
  const p = curPlayer();
  if (G.pendingBuy === null) return;
  const id = G.pendingBuy;
  const sp = SPACES[id];
  if (p.money < sp.price) {
    toast("Not enough money!", "danger");
    return;
  }
  p.money -= sp.price;
  G.properties[id].owner = p.id;
  if (sp.type === "property") p.properties.push(id);
  else if (sp.type === "railroad") p.railroads.push(id);
  else if (sp.type === "utility") p.utilities.push(id);
  G.pendingBuy = null;
  addLog(
    `${p.name} bought ${sp.name} for ${fmtCurrency(sp.price)}!`,
    "success",
  );
  playSfx("buy");
  toast(`🏠 Bought ${sp.name}!`, "gold");
  G.phase = "end";
  renderAll();
  animatePropertyPurchase(id);
  updateActionButtons();
}

function startAuction() {
  if (!requireTurnControl()) return;
  closeOverlay("buy-overlay");
  const id = G.pendingBuy;
  G.pendingBuy = null;
  const sp = SPACES[id];
  if (!isAuctionSystemEnabled()) {
    if (sp) {
      addLog(`Auction is disabled. ${sp.name} remains unsold.`, "important");
    }
    G.phase = "end";
    renderAll();
    updateActionButtons();
    return;
  }
  if (
    !beginAuction(id, {
      source: "market",
      bidderStartIdx: G.currentPlayerIdx,
    })
  ) {
    addLog("Auction could not start (no eligible bidders).", "danger");
    G.phase = "end";
    renderAll();
    updateActionButtons();
  }
}

function beginAuction(propId, { source = "market", bidderStartIdx = 0 } = {}) {
  if (!isAuctionSystemEnabled()) return false;
  const sp = SPACES[propId];
  const prop = G.properties[propId];
  if (!sp || !prop || prop.owner !== null) return false;
  const activePlayers = G.players.filter((p) => !p.bankrupt).map((p) => p.id);
  if (!activePlayers.length) return false;
  const startPos = activePlayers.includes(bidderStartIdx)
    ? activePlayers.indexOf(bidderStartIdx)
    : 0;
  const openingPercent = pickAuctionOpeningPercent();
  const openingBid = getAuctionOpeningBid(sp.price, openingPercent);

  G.auctionState = {
    propId,
    propName: sp.name,
    currentBid: openingBid,
    highBidder: null,
    passed: new Set(),
    bidderIdx: startPos,
    activePlayers,
    source,
  };
  addLog(
    `Auction opened for ${sp.name} at ${fmtCurrency(openingBid)} (${openingPercent}% opening bid).`,
  );
  playSfx("auction-open");
  renderAuction();
  openOverlay("auction-overlay");
  maybeScheduleOfflineAiTurn();
  return true;
}

function queueBankAuctions(propIds = []) {
  if (!isAuctionSystemEnabled()) return;
  if (!Array.isArray(G.bankAuctionQueue)) G.bankAuctionQueue = [];
  propIds.forEach((id) => {
    if (!Number.isInteger(id)) return;
    if (!G.bankAuctionQueue.includes(id)) G.bankAuctionQueue.push(id);
  });
}

function launchNextBankAuction() {
  if (!isAuctionSystemEnabled()) {
    G.auctionState = null;
    G.bankAuctionQueue = [];
    return false;
  }
  if (G.auctionState) return true;
  if (!Array.isArray(G.bankAuctionQueue)) G.bankAuctionQueue = [];

  while (G.bankAuctionQueue.length) {
    const nextId = G.bankAuctionQueue.shift();
    const prop = G.properties[nextId];
    if (!prop || prop.owner !== null) continue;
    const started = beginAuction(nextId, {
      source: "bank",
      bidderStartIdx: 0,
    });
    if (started) {
      addLog(`Bank auction started for ${SPACES[nextId].name}.`, "important");
      return true;
    }
  }
  return false;
}

function renderAuction() {
  const a = G.auctionState;
  if (!a) return;
  const aiBidderTurn = isOfflineAiAuctionTurn();
  const bidderId = currentAuctionBidderId();
  const bidder = Number.isInteger(bidderId) ? G.players[bidderId] : null;
  const leader = Number.isInteger(a.highBidder)
    ? G.players[a.highBidder]
    : null;
  const basePrice = Number(SPACES[a.propId]?.price) || 0;
  document.getElementById("auc-prop-name").textContent = a.propName;
  document.getElementById("auc-base-price").textContent =
    fmtCurrency(basePrice);
  document.getElementById("auc-bid").textContent = fmtCurrency(a.currentBid);
  document.getElementById("auc-leader").textContent = leader?.name || "None";
  document.getElementById("auc-bidder").textContent = bidder
    ? `${bidder.name}${aiBidderTurn ? " (AI thinking...)" : ""}`
    : "Waiting for bidder sync...";
  document.getElementById("auc-bidder-money").textContent = fmtCurrency(
    bidder?.money || 0,
  );

  openOverlay("auction-overlay");

  const canAct = !aiBidderTurn && canLocalControlAuctionAction();
  document.querySelectorAll("#bid-btns button").forEach((btn) => {
    btn.disabled = !canAct;
  });
}

function nextAuctionBidderIndex(a, startIdx) {
  if (!a || !Array.isArray(a.activePlayers) || !a.activePlayers.length)
    return -1;
  if (!(a.passed instanceof Set)) {
    a.passed = new Set(
      indexedObjectToArray(a.passed).map(Number).filter(Number.isInteger),
    );
  }

  const len = a.activePlayers.length;
  let cursor = Number.isFinite(Number(startIdx))
    ? Math.trunc(Number(startIdx))
    : 0;
  for (let i = 0; i < len; i++) {
    const idx = ((cursor % len) + len) % len;
    const playerId = Number(a.activePlayers[idx]);
    if (!a.passed.has(playerId)) return idx;
    cursor++;
  }
  return -1;
}

function finalizeAuction(a) {
  if (!a) return;
  const source = a.source || "market";
  let awardedPropId = null;
  closeOverlay("auction-overlay");

  if (a.highBidder !== null && a.currentBid > 0) {
    const winner = G.players[a.highBidder];
    const sp = SPACES[a.propId];
    const prop = G.properties[a.propId];
    if (winner && sp && prop && prop.owner === null) {
      winner.money -= a.currentBid;
      prop.owner = winner.id;
      prop.houses = 0;
      prop.hotel = false;
      addOwnedAsset(winner, a.propId);
      awardedPropId = a.propId;
      addLog(
        `${winner.name} wins auction for ${sp.name} at ${fmtCurrency(a.currentBid)}!`,
        "success",
      );
      playSfx("auction-win");
    } else {
      addLog(
        `Auction for ${a.propName} ended with invalid winner state; property remains unsold.`,
        "danger",
      );
    }
  } else {
    addLog(
      `Auction cancelled — all players passed. ${a.propName} remains unsold.`,
    );
  }

  G.auctionState = null;

  if (source === "bank") {
    if (launchNextBankAuction()) {
      renderAll();
      if (Number.isInteger(awardedPropId))
        animatePropertyPurchase(awardedPropId);
      updateActionButtons();
      return;
    }
    addLog("Bank auction series completed.", "important");
    checkBankruptcy();
  }

  G.phase = "end";
  renderAll();
  if (Number.isInteger(awardedPropId)) animatePropertyPurchase(awardedPropId);
  updateActionButtons();
}

function placeBid(amount) {
  if (!requireAuctionControl()) return;
  const a = G.auctionState;
  if (!a) return;
  if (!(a.passed instanceof Set)) {
    a.passed = new Set(
      indexedObjectToArray(a.passed).map(Number).filter(Number.isInteger),
    );
  }
  const bidderId = currentAuctionBidderId();
  if (!Number.isInteger(bidderId)) return;
  const bidder = G.players[bidderId];
  if (!bidder || bidder.bankrupt) return;
  const newBid = a.currentBid + amount;
  if (bidder.money < newBid) {
    toast("Not enough money!", "danger");
    return;
  }
  a.currentBid = newBid;
  a.highBidder = bidder.id;
  addLog(`${bidder.name} bids ${fmtCurrency(newBid)} for ${a.propName}`);
  playSfx("bid");

  const remaining = a.activePlayers.filter((id) => !a.passed.has(id));
  if (remaining.length <= 1 && a.highBidder !== null) {
    finalizeAuction(a);
    return;
  }

  const nextIdx = nextAuctionBidderIndex(a, Number(a.bidderIdx) + 1);
  if (nextIdx < 0) {
    addLog(
      "Auction state had no eligible next bidder; finalizing current auction.",
      "danger",
    );
    finalizeAuction(a);
    return;
  }
  a.bidderIdx = nextIdx;
  renderAuction();
  maybeScheduleOfflineAiTurn();
}

function passAuction() {
  if (!requireAuctionControl()) return;
  const a = G.auctionState;
  if (!a) return;
  if (!(a.passed instanceof Set)) {
    a.passed = new Set(
      indexedObjectToArray(a.passed).map(Number).filter(Number.isInteger),
    );
  }
  const bidderId = currentAuctionBidderId();
  if (!Number.isInteger(bidderId)) return;
  const bidder = G.players[bidderId];
  if (!bidder) return;
  a.passed.add(bidder.id);
  addLog(`${bidder.name} passes the auction`);
  // Check if only one active bidder remains
  const remaining = a.activePlayers.filter((id) => !a.passed.has(id));
  if (
    remaining.length === 0 ||
    (remaining.length === 1 && a.highBidder !== null)
  ) {
    finalizeAuction(a);
    return;
  }

  const nextIdx = nextAuctionBidderIndex(a, Number(a.bidderIdx) + 1);
  if (nextIdx < 0) {
    addLog(
      "Auction pass advanced to no eligible bidder; finalizing current auction.",
      "danger",
    );
    finalizeAuction(a);
    return;
  }
  a.bidderIdx = nextIdx;
  renderAuction();
  maybeScheduleOfflineAiTurn();
}

// ═══════════════════════════════════════════════
//  BUILDING
// ═══════════════════════════════════════════════
function buildableGroups(p) {
  const groups = {};
  p.properties.forEach((id) => {
    const sp = SPACES[id];
    if (!groups[sp.group]) groups[sp.group] = [];
    groups[sp.group].push(id);
  });
  const buildable = [];
  Object.keys(groups).forEach((g) => {
    const groupIds = SPACES.filter(
      (s) => s.type === "property" && s.group === parseInt(g),
    ).map((s) => s.id);
    const monopoly = groupIds.every((id) => G.properties[id]?.owner === p.id);
    const hasMortgaged = groupIds.some((id) => !!G.properties[id]?.mortgaged);
    if (monopoly && !hasMortgaged) buildable.push(groupIds);
  });
  return buildable;
}

function openBuildModal() {
  const p = curPlayer();
  const groups = buildableGroups(p);
  const el = document.getElementById("build-list");
  el.innerHTML = "";
  if (groups.length === 0) {
    el.innerHTML =
      '<p style="color:rgba(255,255,255,.5);font-size:.85rem">No complete color groups to build on.</p>';
  }
  groups.forEach((ids) => {
    ids.forEach((id) => {
      const sp = SPACES[id];
      const prop = G.properties[id];
      const row = document.createElement("div");
      row.style.cssText =
        "display:flex;align-items:center;gap:.7rem;padding:.6rem;background:rgba(255,255,255,.06);border-radius:7px;margin-bottom:.4rem";
      const c = COLOR[sp.color];
      const houseCost = sp.house;
      const canBuildMore =
        !prop.hotel && prop.houses < 4 && p.money >= houseCost;
      const canBuildHotel =
        prop.houses === 4 && !prop.hotel && p.money >= houseCost;
      const canSell = prop.houses > 0 || prop.hotel;
      row.innerHTML = `
        <div style="width:10px;height:10px;border-radius:2px;background:${c};flex-shrink:0"></div>
        <div style="flex:1;color:#fff;font-size:.85rem;font-weight:600">${sp.name}</div>
        <div style="color:rgba(255,255,255,.5);font-size:.78rem">${prop.hotel ? "🏨" : "🏠".repeat(prop.houses) || "—"}</div>
        <button onclick="buildHouse(${id})" ${canBuildMore && !prop.hotel ? "" : canBuildHotel ? "" : "disabled"} style="background:${canBuildMore || canBuildHotel ? "#2ecc71" : "rgba(255,255,255,.1)"};border:none;color:#fff;border-radius:5px;padding:.3rem .5rem;cursor:pointer;font-size:.75rem">${prop.houses === 4 && !prop.hotel ? `🏨 Hotel (${fmtCurrency(houseCost)})` : `🏠 Build (${fmtCurrency(houseCost)})`}</button>
        <button onclick="sellHouse(${id})" ${canSell ? "" : "disabled"} style="background:${canSell ? "#e74c3c" : "rgba(255,255,255,.1)"};border:none;color:#fff;border-radius:5px;padding:.3rem .5rem;cursor:pointer;font-size:.75rem">Sell (${fmtCurrency(Math.floor(houseCost / 2))})</button>
      `;
      el.appendChild(row);
    });
  });
  openOverlay("build-overlay");
}

function buildHouse(propId) {
  if (!requireTurnControl()) return;
  const p = curPlayer();
  const actorIsAi = shouldAutoActForAi(p);
  const sp = SPACES[propId];
  const prop = G.properties[propId];
  if (!sp || !prop || sp.type !== "property") return;
  if (prop.owner !== p.id) {
    toast("You do not own this property.", "danger");
    return;
  }
  if (prop.mortgaged) {
    toast("Cannot build on a mortgaged property.", "danger");
    return;
  }
  if (prop.hotel) {
    toast("This property already has a hotel.", "danger");
    return;
  }

  const groupIds = SPACES.filter(
    (s) => s.type === "property" && s.group === sp.group,
  ).map((s) => s.id);
  const monopoly = groupIds.every((id) => G.properties[id]?.owner === p.id);
  if (!monopoly) {
    toast("Own the full color group to build.", "danger");
    return;
  }
  if (groupIds.some((id) => G.properties[id]?.mortgaged)) {
    toast("Unmortgage this color group before building.", "danger");
    return;
  }

  const cost = sp.house;
  if (p.money < cost) {
    toast("Not enough money!", "danger");
    return;
  }
  p.money -= cost;
  playSfx("build");
  if (prop.houses >= 4) {
    prop.hotel = true;
    prop.houses = 0;
    addLog(
      `${p.name} built a hotel on ${sp.name} for ${fmtCurrency(cost)}.`,
      "success",
    );
  } else {
    prop.houses++;
    addLog(
      `${p.name} built house #${prop.houses} on ${sp.name} for ${fmtCurrency(cost)}.`,
      "success",
    );
  }
  renderAll();
  if (actorIsAi) closeOverlay("build-overlay");
  else openBuildModal(); // refresh
  updateTopBar();
}

function sellHouse(propId) {
  if (!requireTurnControl()) return;
  const p = curPlayer();
  const actorIsAi = shouldAutoActForAi(p);
  const sp = SPACES[propId];
  const prop = G.properties[propId];
  const refund = Math.floor(sp.house / 2);
  p.money += refund;
  playSfx("sell");
  if (prop.hotel) {
    prop.hotel = false;
    prop.houses = 4;
    addLog(`${p.name} sold hotel on ${sp.name} for ${fmtCurrency(refund)}.`);
  } else {
    prop.houses--;
    addLog(`${p.name} sold house on ${sp.name} for ${fmtCurrency(refund)}.`);
  }
  renderAll();
  if (actorIsAi) {
    closeOverlay("build-overlay");
  } else {
    const resolved = tryResolveDebtPrompt();
    if (resolved) {
      closeOverlay("build-overlay");
      updateTopBar();
      return;
    }
    openBuildModal();
  }
  updateTopBar();
}

// ═══════════════════════════════════════════════
//  MORTGAGE
// ═══════════════════════════════════════════════
function propertyHasBuildings(id) {
  const prop = G.properties[id];
  return !!(prop && (prop.houses > 0 || prop.hotel));
}

function propertyGroupHasBuildings(id, includeSelf = true) {
  const sp = SPACES[id];
  if (!sp || sp.type !== "property") return false;
  const groupIds = SPACES.filter(
    (s) => s.type === "property" && s.group === sp.group,
  ).map((s) => s.id);
  return groupIds.some(
    (gid) => (includeSelf || gid !== id) && propertyHasBuildings(gid),
  );
}

function tradeAssetBuildingBlockReason(id) {
  const sp = SPACES[id];
  if (!sp) return "";
  if (propertyHasBuildings(id))
    return `Sell buildings on ${sp.name} before trading it.`;
  if (propertyGroupHasBuildings(id, false)) {
    return `Sell buildings in the ${sp.color} group before trading ${sp.name}.`;
  }
  return "";
}

function mortgageValueForSpace(sp) {
  return Math.floor((Number(sp?.price) || 0) / 2);
}

function canMortgageAsset(player, id) {
  const sp = SPACES[id];
  const prop = G.properties[id];
  if (!sp || !prop || prop.owner !== player.id || prop.mortgaged) return false;
  if (propertyHasBuildings(id)) return false;

  // Monopoly rule: cannot mortgage a color property while any property in that color group has buildings.
  if (sp.type === "property") {
    if (propertyGroupHasBuildings(id, true)) return false;
  }
  return true;
}

function openMortgageModal() {
  const p = curPlayer();
  const el = document.getElementById("mortgage-list");
  el.innerHTML = "";
  const allProps = [...p.properties, ...p.railroads, ...p.utilities];
  if (allProps.length === 0) {
    el.innerHTML =
      '<p style="color:rgba(255,255,255,.5);font-size:.85rem">You own no properties.</p>';
  }
  allProps.forEach((id) => {
    const sp = SPACES[id];
    const prop = G.properties[id];
    const row = document.createElement("div");
    row.style.cssText =
      "display:flex;align-items:center;gap:.7rem;padding:.6rem;background:rgba(255,255,255,.06);border-radius:7px;margin-bottom:.4rem";
    const color = sp.type === "property" ? COLOR[sp.color] : "#666";
    const canMortgage = canMortgageAsset(p, id);
    const mortgageValue = mortgageValueForSpace(sp);
    const unmortgageCost = Math.floor(mortgageValue * 1.1);
    const canUnmortgage = prop.mortgaged && p.money >= unmortgageCost;
    row.innerHTML = `
      <div style="width:10px;height:10px;border-radius:2px;background:${color};flex-shrink:0"></div>
      <div style="flex:1;color:${prop.mortgaged ? "rgba(255,255,255,.4)" : "#fff"};font-size:.85rem;font-weight:600">${sp.name}${prop.mortgaged ? " (mortgaged)" : ""}</div>
      ${
        !prop.mortgaged
          ? `<button onclick="mortgageProp(${id})" ${canMortgage ? "" : "disabled"} style="background:${canMortgage ? "#d97706" : "rgba(255,255,255,.1)"};border:none;color:#fff;border-radius:5px;padding:.3rem .5rem;cursor:pointer;font-size:.75rem">Mortgage ${fmtCurrency(mortgageValue)}</button>`
          : `<button onclick="unmortgageProp(${id})" ${canUnmortgage ? "" : "disabled"} style="background:${canUnmortgage ? "#2ecc71" : "rgba(255,255,255,.1)"};border:none;color:#fff;border-radius:5px;padding:.3rem .5rem;cursor:pointer;font-size:.75rem">Unmortgage ${fmtCurrency(unmortgageCost)}</button>`
      }
    `;
    el.appendChild(row);
  });
  openOverlay("mortgage-overlay");
}

function mortgageProp(id) {
  if (!requireTurnControl()) return;
  const p = curPlayer();
  const actorIsAi = shouldAutoActForAi(p);
  const sp = SPACES[id];
  const prop = G.properties[id];
  if (!canMortgageAsset(p, id)) {
    toast("Sell buildings in this color group before mortgaging.", "danger");
    return;
  }
  const mortgageValue = mortgageValueForSpace(sp);
  prop.mortgaged = true;
  p.money += mortgageValue;
  playSfx("mortgage");
  addLog(`${p.name} mortgaged ${sp.name} for ${fmtCurrency(mortgageValue)}.`);
  renderAll();
  if (actorIsAi) closeOverlay("mortgage-overlay");
  else openMortgageModal();
  if (!actorIsAi) {
    if (tryResolveDebtPrompt()) return;
  }
  updateTopBar();
}

function unmortgageProp(id) {
  if (!requireTurnControl()) return;
  const p = curPlayer();
  const actorIsAi = shouldAutoActForAi(p);
  const sp = SPACES[id];
  const prop = G.properties[id];
  const cost = Math.floor(mortgageValueForSpace(sp) * 1.1);
  if (p.money < cost) {
    toast("Not enough money!", "danger");
    return;
  }
  prop.mortgaged = false;
  p.money -= cost;
  playSfx("unmortgage");
  addLog(`${p.name} unmortgaged ${sp.name} for ${fmtCurrency(cost)}.`);
  renderAll();
  if (actorIsAi) closeOverlay("mortgage-overlay");
  else openMortgageModal();
  if (!actorIsAi) {
    if (tryResolveDebtPrompt()) return;
  }
  updateTopBar();
}

// ═══════════════════════════════════════════════
//  TRADE
// ═══════════════════════════════════════════════
let tradeSelected = { mine: [], theirs: [] };

function getLocalPlayerIndex() {
  if (!isOnlineGame()) return G.currentPlayerIdx;
  return resolveLocalPlayerIndex();
}

function getPendingTradeRole() {
  if (!G.pendingTrade) return "none";
  if (!isOnlineGame()) {
    const recipient = G.players[Number(G.pendingTrade.toId)];
    return isAiPlayer(recipient) ? "ai-recipient" : "offline";
  }
  const me = getLocalPlayerIndex();
  if (me === G.pendingTrade.toId) return "recipient";
  if (me === G.pendingTrade.fromId) return "proposer";
  return "spectator";
}

function tradeOfferPropsHtml(ids) {
  if (!Array.isArray(ids) || !ids.length) {
    return '<div style="color:rgba(255,255,255,.4);font-size:.82rem">No properties</div>';
  }
  return ids
    .map((id) => {
      const sp = SPACES[id];
      if (!sp) return "";
      const c = sp.type === "property" ? COLOR[sp.color] : "#666";
      return `<div class="trade-prop-item" style="cursor:default"><div class="tprop-dot" style="background:${c}"></div>${escHtml(sp.name)}</div>`;
    })
    .join("");
}

function renderTradeReviewModal() {
  const modal = document.getElementById("trade-review-modal");
  const trade = G.pendingTrade;
  if (!modal) return;
  if (!trade) {
    modal.innerHTML =
      '<h2>🤝 Trade</h2><p style="color:rgba(255,255,255,.6)">No pending trade proposal.</p>';
    return;
  }

  const from = G.players[trade.fromId];
  const to = G.players[trade.toId];
  if (!from || !to) {
    modal.innerHTML =
      '<h2>🤝 Trade</h2><p style="color:#ff9ca1">This trade is no longer valid.</p>';
    return;
  }

  const role = getPendingTradeRole();
  const canRespond = role === "recipient" || role === "offline";
  const canCancel = role === "proposer" || role === "offline";
  const statusLabel =
    role === "recipient"
      ? "📨 Your response is needed"
      : role === "proposer"
        ? `⏳ Waiting for ${to.name}`
        : role === "ai-recipient"
          ? `🤖 ${to.name} is reviewing this trade`
          : role === "offline"
            ? "🧪 Local trade review mode"
            : "ℹ️ Trade in progress";
  const statusStyle =
    role === "recipient"
      ? "background:rgba(22,163,74,.2);border:1px solid rgba(74,222,128,.45);color:#b7f7cb;"
      : role === "proposer"
        ? "background:rgba(37,99,235,.25);border:1px solid rgba(125,211,252,.45);color:#d8ecff;"
        : role === "ai-recipient"
          ? "background:rgba(59,130,246,.2);border:1px solid rgba(147,197,253,.5);color:#dbeafe;"
          : role === "offline"
            ? "background:rgba(217,119,6,.2);border:1px solid rgba(252,211,77,.45);color:#ffe9b8;"
            : "background:rgba(148,163,184,.2);border:1px solid rgba(203,213,225,.45);color:#e2e8f0;";
  const roleText =
    role === "recipient"
      ? "You received this trade offer."
      : role === "proposer"
        ? `Waiting for ${to.name} to respond.`
        : role === "ai-recipient"
          ? `${to.name} is deciding automatically.`
          : role === "offline"
            ? `${from.name} offered this trade to ${to.name}.`
            : "Trade in progress.";

  modal.innerHTML = `
    <h2>🤝 Trade Proposal</h2>
    <div style="display:inline-flex;align-items:center;padding:.28rem .62rem;border-radius:999px;font-size:.74rem;font-weight:700;letter-spacing:.02em;margin-bottom:.55rem;${statusStyle}">${escHtml(statusLabel)}</div>
    <p style="color:rgba(255,255,255,.62);font-size:.82rem;margin-bottom:.75rem">${escHtml(roleText)}</p>
    <div class="trade-sides">
      <div>
        <h4>${escHtml(from.name)} gives</h4>
        <div class="trade-prop-list">${tradeOfferPropsHtml(trade.fromProps)}</div>
        <div style="margin-top:.5rem;color:rgba(255,255,255,.7);font-size:.82rem">Money: ${fmtCurrency(trade.fromMoney || 0)}</div>
      </div>
      <div>
        <h4>${escHtml(to.name)} gives</h4>
        <div class="trade-prop-list">${tradeOfferPropsHtml(trade.toProps)}</div>
        <div style="margin-top:.5rem;color:rgba(255,255,255,.7);font-size:.82rem">Money: ${fmtCurrency(trade.toMoney || 0)}</div>
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-primary" onclick="respondTrade(true)" ${canRespond ? "" : "disabled"}>✅ Accept</button>
      <button class="btn btn-danger" onclick="respondTrade(false)" ${canRespond ? "" : "disabled"}>❌ Decline</button>
      <button class="btn" style="background:rgba(255,255,255,.1);color:#fff" onclick="cancelTradeProposal()" ${canCancel ? "" : "disabled"}>Cancel Proposal</button>
    </div>
  `;
}

function maybeShowPendingTradeReview() {
  const overlay = document.getElementById("trade-review-overlay");
  if (!overlay) return;
  if (!G.pendingTrade) {
    tradeReviewShownKey = "";
    closeOverlay("trade-review-overlay");
    return;
  }

  const role = getPendingTradeRole();
  if (role === "spectator") {
    closeOverlay("trade-review-overlay");
    return;
  }

  renderTradeReviewModal();
  const key = `${G.pendingTrade.id || "trade"}:${role}`;
  if (!overlay.classList.contains("show") || tradeReviewShownKey !== key) {
    tradeReviewShownKey = key;
    const activeOverlay = document.querySelector(".overlay.show");
    if (!activeOverlay || activeOverlay.id === "trade-review-overlay") {
      openOverlay("trade-review-overlay");
    }
  }
}

function validatePendingTrade(trade) {
  if (!trade) return "Trade proposal is missing.";
  const from = G.players[trade.fromId];
  const to = G.players[trade.toId];
  if (!from || !to || from.bankrupt || to.bankrupt)
    return "One of the players is bankrupt.";
  if (trade.fromMoney > from.money)
    return `${from.name} no longer has enough cash.`;
  if (trade.toMoney > to.money) return `${to.name} no longer has enough cash.`;

  for (const id of trade.fromProps || []) {
    const sp = SPACES[id];
    const prop = G.properties[id];
    if (!sp || !prop || prop.owner !== from.id)
      return `${from.name} no longer owns ${sp?.name || "a property"}.`;
    const blockReason = tradeAssetBuildingBlockReason(id);
    if (blockReason) return blockReason;
  }

  for (const id of trade.toProps || []) {
    const sp = SPACES[id];
    const prop = G.properties[id];
    if (!sp || !prop || prop.owner !== to.id)
      return `${to.name} no longer owns ${sp?.name || "a property"}.`;
    const blockReason = tradeAssetBuildingBlockReason(id);
    if (blockReason) return blockReason;
  }

  return "";
}

function applyAcceptedTrade(trade) {
  const from = G.players[trade.fromId];
  const to = G.players[trade.toId];

  (trade.fromProps || []).forEach((id) => {
    const prop = G.properties[id];
    if (!prop) return;
    prop.owner = to.id;
    clearOwnedAsset(from, id);
    addOwnedAsset(to, id);
  });

  (trade.toProps || []).forEach((id) => {
    const prop = G.properties[id];
    if (!prop) return;
    prop.owner = from.id;
    clearOwnedAsset(to, id);
    addOwnedAsset(from, id);
  });

  from.money = from.money - (trade.fromMoney || 0) + (trade.toMoney || 0);
  to.money = to.money - (trade.toMoney || 0) + (trade.fromMoney || 0);

  addLog(`${from.name} and ${to.name} completed a trade.`, "success");
}

function openTradeModal() {
  if (G.pendingTrade) {
    toast("Resolve the current trade proposal first.", "danger");
    maybeShowPendingTradeReview();
    return;
  }

  const p = curPlayer();
  const sel = document.getElementById("trade-partner");
  sel.innerHTML = "";
  G.players.forEach((op, i) => {
    if (i !== p.id && !op.bankrupt) {
      const opt = document.createElement("option");
      opt.value = i;
      opt.textContent = `${op.token} ${op.name}`;
      sel.appendChild(opt);
    }
  });
  tradeSelected = { mine: [], theirs: [] };
  document.getElementById("trade-my-money").value = 0;
  document.getElementById("trade-their-money").value = 0;
  if (!sel.options.length) {
    toast("No valid trade partners available.", "danger");
    return;
  }
  renderTradeProps();
  openOverlay("trade-overlay");
}

function renderTradeProps() {
  const p = curPlayer();
  const partnerId = parseInt(
    document.getElementById("trade-partner").value,
    10,
  );
  const partner = G.players[partnerId];

  const renderList = (el, props, isMyList) => {
    el.innerHTML = "";
    props.forEach((id) => {
      const sp = SPACES[id];
      const listKey = isMyList ? "mine" : "theirs";
      const list = tradeSelected[listKey];
      const blockReason = tradeAssetBuildingBlockReason(id);
      const selected = list.includes(id);
      if (blockReason && selected) {
        const idx = list.indexOf(id);
        if (idx >= 0) list.splice(idx, 1);
      }
      const item = document.createElement("div");
      item.className =
        "trade-prop-item" + (selected && !blockReason ? " selected" : "");
      const c = sp.type === "property" ? COLOR[sp.color] : "#666";
      item.innerHTML = `<div class="tprop-dot" style="background:${c}"></div>${sp.name}`;
      if (blockReason) {
        item.style.opacity = ".55";
        item.style.cursor = "not-allowed";
        item.title = blockReason;
      }
      item.onclick = () => {
        if (blockReason) {
          toast(blockReason, "danger");
          return;
        }
        const idx = list.indexOf(id);
        if (idx >= 0) list.splice(idx, 1);
        else list.push(id);
        renderTradeProps();
      };
      el.appendChild(item);
    });
    if (props.length === 0)
      el.innerHTML =
        '<div style="color:rgba(255,255,255,.3);font-size:.8rem;padding:.3rem">No properties</div>';
  };

  const myAll = [...p.properties, ...p.railroads, ...p.utilities];
  const theirAll = partner
    ? [...partner.properties, ...partner.railroads, ...partner.utilities]
    : [];
  renderList(document.getElementById("trade-my-props"), myAll, true);
  renderList(document.getElementById("trade-their-props"), theirAll, false);
}

function confirmTrade() {
  if (!requireTurnControl()) return;
  if (G.pendingTrade) {
    toast("A trade is already pending.", "danger");
    return;
  }

  const p = curPlayer();
  const partnerId = parseInt(
    document.getElementById("trade-partner").value,
    10,
  );
  const partner = G.players[partnerId];
  if (!partner || partner.bankrupt || partner.id === p.id) {
    toast("Select a valid trade partner.", "danger");
    return;
  }

  const myMoney = Math.max(
    0,
    parseInt(document.getElementById("trade-my-money").value, 10) || 0,
  );
  const theirMoney = Math.max(
    0,
    parseInt(document.getElementById("trade-their-money").value, 10) || 0,
  );

  const myBlocked = tradeSelected.mine.find(
    (id) => !!tradeAssetBuildingBlockReason(id),
  );
  if (myBlocked !== undefined) {
    toast(tradeAssetBuildingBlockReason(myBlocked), "danger");
    return;
  }
  const theirBlocked = tradeSelected.theirs.find(
    (id) => !!tradeAssetBuildingBlockReason(id),
  );
  if (theirBlocked !== undefined) {
    toast(tradeAssetBuildingBlockReason(theirBlocked), "danger");
    return;
  }

  if (myMoney > p.money) {
    toast("You don't have that much money!", "danger");
    return;
  }
  if (theirMoney > partner.money) {
    toast(`${partner.name} doesn\'t have that much!`, "danger");
    return;
  }

  const myInvalidOwner = tradeSelected.mine.find(
    (id) => G.properties[id]?.owner !== p.id,
  );
  if (myInvalidOwner !== undefined) {
    toast(`You no longer own ${SPACES[myInvalidOwner].name}.`, "danger");
    return;
  }
  const partnerInvalidOwner = tradeSelected.theirs.find(
    (id) => G.properties[id]?.owner !== partner.id,
  );
  if (partnerInvalidOwner !== undefined) {
    toast(
      `${partner.name} no longer owns ${SPACES[partnerInvalidOwner].name}.`,
      "danger",
    );
    return;
  }

  if (
    !tradeSelected.mine.length &&
    !tradeSelected.theirs.length &&
    myMoney === 0 &&
    theirMoney === 0
  ) {
    toast("Add cash or properties to propose a trade.", "danger");
    return;
  }

  G.pendingTrade = {
    id: `tr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    fromId: p.id,
    toId: partner.id,
    fromProps: [...tradeSelected.mine],
    toProps: [...tradeSelected.theirs],
    fromMoney: myMoney,
    toMoney: theirMoney,
    createdAt: Date.now(),
  };

  tradeReviewShownKey = "";
  addLog(`${p.name} proposed a trade to ${partner.name}.`, "important");
  closeOverlay("trade-overlay");
  renderAll();
  updateActionButtons();
  toast(`Trade proposal sent to ${partner.name}.`, "gold");
}

function respondTrade(acceptTrade) {
  const trade = G.pendingTrade;
  if (!trade) return;

  if (isOnlineGame()) {
    const me = getLocalPlayerIndex();
    const recipient = G.players[trade.toId];
    const aiRecipient = recipient && isAiPlayer(recipient);
    if (me !== trade.toId && !(aiRecipient && canRunAiController())) {
      toast(
        `Only ${G.players[trade.toId]?.name || "the recipient"} can respond.`,
        "danger",
      );
      return;
    }
  }

  const from = G.players[trade.fromId];
  const to = G.players[trade.toId];

  if (!acceptTrade) {
    aiRecordTradeResolution(trade, false);
    addLog(
      `${to?.name || "Player"} declined ${from?.name || "player"}'s trade proposal.`,
      "danger",
    );
    G.pendingTrade = null;
    tradeReviewShownKey = "";
    closeOverlay("trade-review-overlay");
    renderAll();
    updateActionButtons();
    return;
  }

  const invalidReason = validatePendingTrade(trade);
  if (invalidReason) {
    addLog(`Trade proposal canceled: ${invalidReason}`, "danger");
    toast(invalidReason, "danger");
    G.pendingTrade = null;
    tradeReviewShownKey = "";
    closeOverlay("trade-review-overlay");
    renderAll();
    updateActionButtons();
    return;
  }

  applyAcceptedTrade(trade);
  aiRecordTradeResolution(trade, true);
  G.pendingTrade = null;
  tradeReviewShownKey = "";
  closeOverlay("trade-review-overlay");
  renderAll();
  updateActionButtons();
  checkBankruptcy();
  toast("Trade completed! 🤝", "gold");
}

function cancelTradeProposal() {
  const trade = G.pendingTrade;
  if (!trade) return;

  if (isOnlineGame()) {
    const me = getLocalPlayerIndex();
    if (me !== trade.fromId) {
      toast(
        `Only ${G.players[trade.fromId]?.name || "the proposer"} can cancel this trade.`,
        "danger",
      );
      return;
    }
  }

  const from = G.players[trade.fromId];
  const to = G.players[trade.toId];
  addLog(
    `${from?.name || "Player"} canceled the trade proposal to ${to?.name || "player"}.`,
    "danger",
  );
  G.pendingTrade = null;
  tradeReviewShownKey = "";
  closeOverlay("trade-overlay");
  closeOverlay("trade-review-overlay");
  renderAll();
  updateActionButtons();
}

// ═══════════════════════════════════════════════
//  JAIL
// ═══════════════════════════════════════════════
function showJailPrompt(p, mode = "turn") {
  const iconEl = document.getElementById("jail-icon");
  const titleEl = document.getElementById("jail-title");
  const descEl = document.getElementById("jail-desc");
  const actionsEl = document.getElementById("jail-actions");
  if (!iconEl || !titleEl || !descEl || !actionsEl || !p) return;
  const bailAmount = getThemeJailBail(G.boardThemeId || selectedThemeId);

  if (shouldAutoActForAi(p)) {
    closeOverlay("jail-overlay");
    return;
  }

  if (mode === "sent") {
    iconEl.textContent = "🚔";
    titleEl.textContent = "Go to Jail!";
    descEl.textContent =
      p.jailFreeCards > 0
        ? `You have ${p.jailFreeCards} Get Out of Jail Free card(s). On your turn, choose to roll dice or use a card to get out.`
        : `On your turn, choose to roll dice for doubles or pay ${fmtCurrency(bailAmount)} bail.`;
    actionsEl.innerHTML =
      '<button class="btn btn-primary btn-full" onclick="closeOverlay(\'jail-overlay\')">OK</button>';
    openOverlay("jail-overlay");
    return;
  }

  const myTurn = canLocalControlTurn();
  const canPay = p.jailFreeCards > 0 || p.money >= bailAmount;
  const bailLabel =
    p.jailFreeCards > 0
      ? `🎟 Use Card${p.jailFreeCards > 1 ? ` (${p.jailFreeCards})` : ""}`
      : `💳 Pay ${fmtCurrency(bailAmount)} Bail`;

  iconEl.textContent = "⛓️";
  titleEl.textContent = `${p.name} is in Jail`;

  if (!myTurn) {
    descEl.textContent = `Waiting for ${p.name} to choose: roll dice or pay bail.`;
    actionsEl.innerHTML =
      '<button class="btn btn-full" style="background:rgba(255,255,255,.12);color:#fff" onclick="closeOverlay(\'jail-overlay\')">Close</button>';
    openOverlay("jail-overlay");
    return;
  }

  descEl.textContent = `Choose now: roll for doubles or ${p.jailFreeCards > 0 ? "use a card to leave jail" : `pay ${fmtCurrency(bailAmount)} bail`}.`;
  actionsEl.innerHTML = `
    <button class="btn btn-primary" onclick="closeOverlay('jail-overlay'); rollDice();">🎲 Roll Dice</button>
    <button class="btn ${canPay ? "btn-gold" : ""}" ${canPay ? "" : "disabled"} style="${canPay ? "" : "background:rgba(255,255,255,.12);color:rgba(255,255,255,.45)"}" onclick="closeOverlay('jail-overlay'); payBailout();">${bailLabel}</button>
  `;
  openOverlay("jail-overlay");
}

function sendToJail(p) {
  p.inJail = true;
  p.jailTurns = 0;
  p.pos = 10;
  p.doublesCount = 0;
  addLog(`${p.name} goes to jail! ⛓️`, "danger");
  playSfx("jail");
  showJailPrompt(p, "sent");
}

function payBailout() {
  if (!requireTurnControl()) return;
  const p = curPlayer();
  if (!p.inJail) return;
  const bailAmount = getThemeJailBail(G.boardThemeId || selectedThemeId);
  if (p.jailFreeCards > 0) {
    p.jailFreeCards--;
    p.inJail = false;
    p.jailTurns = 0;
    addLog(`${p.name} used a Get Out of Jail Free card!`, "success");
    playSfx("bail");
  } else if (p.money >= bailAmount) {
    chargeMoney(p, bailAmount, null, true);
    p.inJail = false;
    p.jailTurns = 0;
    addLog(
      `${p.name} paid ${fmtCurrency(bailAmount)} bail and is free!`,
      "success",
    );
    playSfx("bail");
  } else {
    toast("Not enough money!", "danger");
    return;
  }
  renderAll();
  updateActionButtons();
}

// ═══════════════════════════════════════════════
//  MONEY & BANKRUPTCY
// ═══════════════════════════════════════════════
function sellBuildingsForEmergencyCash(player) {
  if (!player || player.bankrupt) return 0;
  let raised = 0;
  player.properties.forEach((id) => {
    const sp = SPACES[id];
    const prop = G.properties[id];
    if (!sp || !prop) return;
    if (prop.hotel) {
      const refund = Math.floor((sp.house * 5) / 2);
      prop.hotel = false;
      prop.houses = 0;
      player.money += refund;
      raised += refund;
      addLog(
        `${player.name} sold hotel on ${sp.name} for ${fmtCurrency(refund)}.`,
        "danger",
      );
    }
    if (prop.houses > 0) {
      const count = prop.houses;
      const refund = Math.floor((sp.house * count) / 2);
      prop.houses = 0;
      player.money += refund;
      raised += refund;
      addLog(
        `${player.name} sold ${count} house${count > 1 ? "s" : ""} on ${sp.name} for ${fmtCurrency(refund)}.`,
        "danger",
      );
    }
  });
  return raised;
}

function addOwnedAsset(player, id) {
  const sp = SPACES[id];
  if (!sp || !player) return;
  if (sp.type === "property" && !player.properties.includes(id))
    player.properties.push(id);
  else if (sp.type === "railroad" && !player.railroads.includes(id))
    player.railroads.push(id);
  else if (sp.type === "utility" && !player.utilities.includes(id))
    player.utilities.push(id);
}

function clearOwnedAsset(player, id) {
  removeFrom(player.properties, id);
  removeFrom(player.railroads, id);
  removeFrom(player.utilities, id);
}

function markPlayerBankruptStanding(player, state = G) {
  if (!player || !state || typeof state !== "object") return null;

  const existingOrder = Number(player.bankruptOrder);
  if (Number.isInteger(existingOrder) && existingOrder > 0) {
    const currentSeq = Math.max(0, Number(state.bankruptcySeq) || 0);
    state.bankruptcySeq = Math.max(currentSeq, existingOrder);
    return existingOrder;
  }

  const nextOrder = Math.max(0, Number(state.bankruptcySeq) || 0) + 1;
  state.bankruptcySeq = nextOrder;
  player.bankruptOrder = nextOrder;
  return nextOrder;
}

function syncDebtPromptToGameState() {
  if (!G || typeof G !== "object") return;
  if (!DEBT_PROMPT.active) {
    G.debtPrompt = null;
    return;
  }
  const payerIdRaw = Number(DEBT_PROMPT.payerId);
  const recipientIdRaw = Number(DEBT_PROMPT.recipientId);
  G.debtPrompt = {
    active: true,
    payerId: Number.isInteger(payerIdRaw) ? payerIdRaw : null,
    amount: Math.max(0, Number(DEBT_PROMPT.amount) || 0),
    recipientId: Number.isInteger(recipientIdRaw) ? recipientIdRaw : null,
    toParking: !!DEBT_PROMPT.toParking,
  };
}

function restoreDebtPromptFromGameState(state = G) {
  if (!state || typeof state !== "object") {
    resetDebtPrompt(false);
    return false;
  }
  const raw =
    state.debtPrompt && typeof state.debtPrompt === "object"
      ? state.debtPrompt
      : null;
  if (!raw || raw.active === false) {
    resetDebtPrompt(false);
    if (state === G) state.debtPrompt = null;
    return false;
  }

  const payerId = Number(raw.payerId);
  const payerValid =
    Number.isInteger(payerId) &&
    Array.isArray(state.players) &&
    payerId >= 0 &&
    payerId < state.players.length;
  const payer = payerValid ? state.players[payerId] : null;
  if (!payer || payer.bankrupt) {
    resetDebtPrompt(false);
    if (state === G) state.debtPrompt = null;
    return false;
  }

  const recipientIdRaw = Number(raw.recipientId);
  const recipientId =
    Number.isInteger(recipientIdRaw) &&
    recipientIdRaw >= 0 &&
    recipientIdRaw < state.players.length
      ? recipientIdRaw
      : null;

  DEBT_PROMPT.active = true;
  DEBT_PROMPT.payerId = payerId;
  DEBT_PROMPT.amount = Math.max(0, Number(raw.amount) || 0);
  DEBT_PROMPT.recipientId = recipientId;
  DEBT_PROMPT.toParking = !!raw.toParking;

  if (state === G) syncDebtPromptToGameState();
  return true;
}

function normalizeDebtPromptTurn() {
  if (
    !DEBT_PROMPT.active ||
    !G ||
    !Array.isArray(G.players) ||
    !G.players.length
  )
    return false;
  const payerId = Number(DEBT_PROMPT.payerId);
  if (
    !Number.isInteger(payerId) ||
    payerId < 0 ||
    payerId >= G.players.length ||
    G.players[payerId]?.bankrupt
  ) {
    resetDebtPrompt();
    closeOverlay("bankrupt-overlay");
    return true;
  }
  if (Number(G.currentPlayerIdx) !== payerId) {
    G.currentPlayerIdx = payerId;
    if (G.phase === "roll") G.phase = "action";
    return true;
  }
  return false;
}

function hasPendingDebtPromptForCurrentPlayer() {
  return !!(
    DEBT_PROMPT.active &&
    Number(DEBT_PROMPT.payerId) === Number(G.currentPlayerIdx)
  );
}

function resetDebtPrompt(updateGameState = true) {
  DEBT_PROMPT.active = false;
  DEBT_PROMPT.payerId = null;
  DEBT_PROMPT.amount = 0;
  DEBT_PROMPT.recipientId = null;
  DEBT_PROMPT.toParking = false;
  if (updateGameState && G && typeof G === "object") {
    G.debtPrompt = null;
  }
}

function showDebtPrompt(p, amount, recipient = null, toParking = false) {
  if (!p) return;
  DEBT_PROMPT.active = true;
  DEBT_PROMPT.payerId = p.id;
  DEBT_PROMPT.amount = Math.max(0, Number(amount) || 0);
  DEBT_PROMPT.recipientId =
    recipient && !recipient.bankrupt ? recipient.id : null;
  DEBT_PROMPT.toParking = !!toParking;

  const shortBy = Math.max(0, DEBT_PROMPT.amount - (Number(p.money) || 0));
  const creditorName =
    DEBT_PROMPT.recipientId !== null
      ? G.players[DEBT_PROMPT.recipientId]?.name || "another player"
      : "the bank";
  const titleEl = document.getElementById("bankrupt-name");
  const descEl = document.getElementById("bankrupt-desc");
  const continueBtn = document.getElementById("bankrupt-continue-btn");
  const mortgageBtn = document.getElementById("bankrupt-mortgage-btn");
  const sellBtn = document.getElementById("bankrupt-sell-btn");
  if (titleEl)
    titleEl.textContent = `${p.name} must pay ${fmtCurrency(DEBT_PROMPT.amount)}`;
  if (descEl) {
    descEl.textContent = `${p.name} owes ${creditorName} and is short by ${fmtCurrency(shortBy)}. Sell buildings or mortgage properties to raise funds, or declare bankruptcy.`;
  }
  if (continueBtn) continueBtn.textContent = "Declare Bankruptcy";
  if (mortgageBtn) mortgageBtn.style.display = "";
  if (sellBtn) {
    const hasBuildings = (p.properties || []).some((id) =>
      propertyHasBuildings(id),
    );
    sellBtn.style.display = hasBuildings ? "" : "none";
  }
  syncDebtPromptToGameState();
  openOverlay("bankrupt-overlay");
}

function openMortgageForDebt() {
  if (!hasPendingDebtPromptForCurrentPlayer()) {
    closeOverlay("bankrupt-overlay");
    return;
  }
  closeOverlay("bankrupt-overlay");
  openMortgageModal();
}

function openBuildForDebt() {
  if (!hasPendingDebtPromptForCurrentPlayer()) {
    closeOverlay("bankrupt-overlay");
    return;
  }
  closeOverlay("bankrupt-overlay");
  openBuildModal();
}

function tryResolveDebtPrompt() {
  if (!DEBT_PROMPT.active) return false;
  const payer = G.players[DEBT_PROMPT.payerId];
  if (!payer || payer.bankrupt) {
    resetDebtPrompt();
    closeOverlay("bankrupt-overlay");
    return false;
  }

  const due = Math.max(0, Number(DEBT_PROMPT.amount) || 0);
  if (payer.money < due) return false;

  payer.money -= due;
  const recipient =
    DEBT_PROMPT.recipientId !== null
      ? G.players[DEBT_PROMPT.recipientId]
      : null;
  if (recipient && !recipient.bankrupt) recipient.money += due;

  const creditorName =
    recipient && !recipient.bankrupt ? recipient.name : "the bank";
  addLog(
    `${payer.name} settled debt of ${fmtCurrency(due)} to ${creditorName}.`,
    "success",
  );
  resetDebtPrompt();
  closeOverlay("bankrupt-overlay");
  closeOverlay("mortgage-overlay");
  renderAll();
  updateActionButtons();
  return true;
}

function chargeMoney(p, amount, recipient = null, toParking = false) {
  if (amount <= 0) {
    if (recipient) recipient.money += Math.abs(amount);
    return true;
  }
  if (!p || p.bankrupt) return false;

  const actorIsAi = shouldAutoActForAi(p);

  if (p.money < amount && actorIsAi) {
    const raised = sellBuildingsForEmergencyCash(p);
    if (raised > 0) {
      addLog(
        `${p.name} raised ${fmtCurrency(raised)} by liquidating buildings.`,
        "important",
      );
    }
  }

  if (actorIsAi && p.money < amount) {
    let usedMortgages = 0;
    while (p.money < amount && usedMortgages < 32) {
      const target = amount + Math.floor(aiCashReserve(p) * 0.25);
      const mortgaged = aiTryMortgageToTarget(p, target);
      if (!mortgaged) break;
      usedMortgages++;
    }
    if (usedMortgages > 0) {
      addLog(
        `${p.name} used ${usedMortgages} emergency mortgage${usedMortgages > 1 ? "s" : ""} to avoid bankruptcy.`,
        "important",
      );
    }
  }

  if (p.money >= amount) {
    p.money -= amount;
    if (recipient && !recipient.bankrupt) recipient.money += amount;
    if (DEBT_PROMPT.active && DEBT_PROMPT.payerId === p.id) {
      resetDebtPrompt();
      closeOverlay("bankrupt-overlay");
    }
    return true;
  }

  if (!actorIsAi) {
    showDebtPrompt(
      p,
      amount,
      recipient && !recipient.bankrupt ? recipient : null,
      toParking,
    );
    return false;
  }

  // Cannot cover debt even after liquidation.
  declareBankruptcy(
    p,
    recipient && !recipient.bankrupt ? recipient : null,
    amount,
    toParking,
  );
  return false;
}

function showRentModal(payer, owner, propName, rent) {
  if (shouldAutoActForAi(payer)) {
    closeOverlay("rent-overlay");
    return;
  }
  document.getElementById("rent-title").textContent = `Rent for ${propName}`;
  document.getElementById("rent-desc").textContent =
    `${payer.name} pays ${fmtCurrency(rent)} to ${owner.name}.`;
  openOverlay("rent-overlay");
}

function checkBankruptcy() {
  G.players.forEach((p) => {
    if (p.bankrupt || p.money >= 0) return;
    declareBankruptcy(p, null, Math.abs(p.money), true);
  });
  maybeShowWinnerFromState();
}

function declareBankruptcy(p, creditor = null, debtAmount = 0, toBank = false) {
  if (!p || p.bankrupt) return;
  playSfx("bankrupt");
  if (DEBT_PROMPT.active && DEBT_PROMPT.payerId === p.id) {
    resetDebtPrompt();
  }

  if (
    G.pendingTrade &&
    (G.pendingTrade.fromId === p.id || G.pendingTrade.toId === p.id)
  ) {
    const from = G.players[G.pendingTrade.fromId];
    const to = G.players[G.pendingTrade.toId];
    addLog(
      `Trade proposal between ${from?.name || "players"} and ${to?.name || "players"} was canceled due to bankruptcy.`,
      "danger",
    );
    G.pendingTrade = null;
    tradeReviewShownKey = "";
    closeOverlay("trade-review-overlay");
  }

  sellBuildingsForEmergencyCash(p);
  p.bankrupt = true;
  markPlayerBankruptStanding(p, G);
  p.inJail = false;

  const assets = [...p.properties, ...p.railroads, ...p.utilities];
  const auctionsEnabled = isAuctionSystemEnabled();

  if (creditor && !creditor.bankrupt && creditor.id !== p.id) {
    addLog(
      `${p.name} is BANKRUPT to ${creditor.name}! Assets transferred.`,
      "danger",
    );
    if (p.money > 0) creditor.money += p.money;
    p.money = 0;

    let interestDue = 0;
    assets.forEach((id) => {
      const prop = G.properties[id];
      const sp = SPACES[id];
      if (!prop || !sp) return;
      clearOwnedAsset(p, id);
      prop.owner = creditor.id;
      addOwnedAsset(creditor, id);
      if (prop.mortgaged) {
        const interest = Math.ceil(mortgageValueForSpace(sp) * 0.1);
        interestDue += interest;
      }
    });

    if (interestDue > 0) {
      creditor.money -= interestDue;
      addLog(
        `${creditor.name} paid ${fmtCurrency(interestDue)} mortgage interest to the bank.`,
        "danger",
      );
      if (creditor.money < 0 && !creditor.bankrupt) {
        addLog(
          `${creditor.name} cannot cover mortgage interest and goes bankrupt to the bank.`,
          "danger",
        );
        declareBankruptcy(creditor, null, Math.abs(creditor.money), true);
      }
    }

    document.getElementById("bankrupt-name").textContent =
      `${p.name} is Bankrupt!`;
    document.getElementById("bankrupt-desc").textContent =
      `${p.name} could not pay ${creditor.name} and turned over all assets.`;
  } else {
    const debtTxt = debtAmount > 0 ? ` (${fmtCurrency(debtAmount)})` : "";
    addLog(
      auctionsEnabled
        ? `${p.name} is BANKRUPT to the Bank${debtTxt}. Bank auctions all properties.`
        : `${p.name} is BANKRUPT to the Bank${debtTxt}. Auction system is OFF, so properties return to the bank unsold.`,
      "danger",
    );
    p.money = 0;

    const auctionIds = [];
    assets.forEach((id) => {
      const prop = G.properties[id];
      if (!prop) return;
      clearOwnedAsset(p, id);
      prop.owner = null;
      prop.houses = 0;
      prop.hotel = false;
      prop.mortgaged = false;
      auctionIds.push(id);
    });

    if (auctionsEnabled) {
      queueBankAuctions(auctionIds);
      if (auctionIds.length) {
        addLog(
          `Bank queued ${auctionIds.length} property auction${auctionIds.length > 1 ? "s" : ""}.`,
          "important",
        );
      }
    } else {
      G.bankAuctionQueue = [];
      G.auctionState = null;
    }

    document.getElementById("bankrupt-name").textContent =
      `${p.name} is Bankrupt!`;
    document.getElementById("bankrupt-desc").textContent = auctionsEnabled
      ? `${p.name} could not pay the Bank. Their properties are queued for auction.`
      : `${p.name} could not pay the Bank. Their properties returned to the bank without auction.`;
  }

  const continueBtn = document.getElementById("bankrupt-continue-btn");
  const mortgageBtn = document.getElementById("bankrupt-mortgage-btn");
  const sellBtn = document.getElementById("bankrupt-sell-btn");
  if (continueBtn) continueBtn.textContent = "Continue";
  if (mortgageBtn) mortgageBtn.style.display = "none";
  if (sellBtn) sellBtn.style.display = "none";

  p.properties = [];
  p.railroads = [];
  p.utilities = [];
  p.bankrupt = true;

  if (shouldAutoActForAi(p)) {
    closeOverlay("bankrupt-overlay");
    G.phase = "end";
    renderAll();
    updateActionButtons();
    if (launchNextBankAuction()) return;
    checkBankruptcy();
    return;
  }

  openOverlay("bankrupt-overlay");
}

function confirmBankruptcy() {
  if (hasPendingDebtPromptForCurrentPlayer()) {
    const payer = G.players[DEBT_PROMPT.payerId];
    const recipient =
      DEBT_PROMPT.recipientId !== null
        ? G.players[DEBT_PROMPT.recipientId]
        : null;
    const debt = Math.max(0, Number(DEBT_PROMPT.amount) || 0);
    const toParking = !!DEBT_PROMPT.toParking;
    resetDebtPrompt();
    if (payer && !payer.bankrupt) {
      declareBankruptcy(
        payer,
        recipient && !recipient.bankrupt ? recipient : null,
        debt,
        toParking,
      );
    }
    return;
  }

  closeOverlay("bankrupt-overlay");
  G.phase = "end";
  renderAll();
  updateActionButtons();
  if (launchNextBankAuction()) return;
  checkBankruptcy();
}

// ═══════════════════════════════════════════════
//  TURN MANAGEMENT
// ═══════════════════════════════════════════════
function endTurn() {
  if (!requireTurnControl()) return;
  if (MOVE_FX.active || (Number(ONLINE.pendingCardResolutions) || 0) > 0) {
    if (!isAiPlayer(curPlayer())) {
      toast("Wait for movement/card effects to finish.", "danger");
    }
    return;
  }
  if (hasPendingDebtPromptForCurrentPlayer()) {
    showDebtPrompt(
      curPlayer(),
      DEBT_PROMPT.amount,
      DEBT_PROMPT.recipientId !== null
        ? G.players[DEBT_PROMPT.recipientId]
        : null,
      DEBT_PROMPT.toParking,
    );
    toast("Settle debt by mortgaging or declare bankruptcy.", "danger");
    return;
  }
  if (G.phase === "roll") {
    toast("You must roll dice first!", "danger");
    return;
  }
  stopTimer();
  G.pendingBuy = null;

  // Advance to next non-bankrupt player
  let next = (G.currentPlayerIdx + 1) % G.players.length;
  let count = 0;
  while (G.players[next].bankrupt && count < G.players.length) {
    next = (next + 1) % G.players.length;
    count++;
  }
  G.currentPlayerIdx = next;
  AI_CTRL.lastTradeAttemptKey = "";
  G.phase = "roll";
  G.lastDoubles = false;
  playSfx("turn");

  const p = curPlayer();
  addLog(`─────── ${p.name}'s turn ───────`, "important");
  renderAll();
  updateActionButtons();
}

