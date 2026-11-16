// Draw within one road cell so the visual scales with each game's map.
export function drawFemalePlayer(ctx, [column, row], cellSize) {
  ctx.save();
  ctx.translate((column + 0.5) * cellSize, (row + 0.5) * cellSize);
  ctx.scale(cellSize / 50, cellSize / 50);

  ctx.fillStyle = '#00000035';
  ctx.beginPath();
  ctx.ellipse(0, 19, 12, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#251f20';
  ctx.beginPath();
  ctx.ellipse(-4, 18, 3, 2, -0.15, 0, Math.PI * 2);
  ctx.ellipse(4, 18, 3, 2, 0.15, 0, Math.PI * 2);
  ctx.fill();

  const dress = ctx.createLinearGradient(-9, 0, 10, 15);
  dress.addColorStop(0, '#688d7c');
  dress.addColorStop(1, '#24483d');
  ctx.fillStyle = dress;
  ctx.beginPath();
  ctx.moveTo(-6, -3);
  ctx.quadraticCurveTo(-10, -2, -10, 4);
  ctx.lineTo(-7, 6);
  ctx.lineTo(-10, 16);
  ctx.quadraticCurveTo(0, 20, 10, 16);
  ctx.lineTo(7, 6);
  ctx.lineTo(10, 4);
  ctx.quadraticCurveTo(10, -2, 6, -3);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#c7b38b';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, -2);
  ctx.lineTo(3, 2);
  ctx.lineTo(2, 14);
  ctx.stroke();

  ctx.fillStyle = '#292326';
  ctx.beginPath();
  ctx.ellipse(0, -10, 9, 11, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#dfb18a';
  ctx.beginPath();
  ctx.ellipse(0, -8, 6.5, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#292326';
  ctx.beginPath();
  ctx.moveTo(-8, -10);
  ctx.bezierCurveTo(-11, -21, 5, -24, 9, -14);
  ctx.quadraticCurveTo(5, -12, 2, -17);
  ctx.quadraticCurveTo(-1, -11, -8, -10);
  ctx.fill();
  ctx.fillRect(-3.5, -9, 1.5, 1.5);
  ctx.fillRect(2, -9, 1.5, 1.5);
  ctx.fillStyle = '#a15f51';
  ctx.fillRect(-1, -4, 2, 1);

  ctx.fillStyle = '#dfb18a';
  ctx.beginPath();
  ctx.ellipse(-9, 6, 2, 3, 0, 0, Math.PI * 2);
  ctx.ellipse(9, 6, 2, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#b69b70';
  ctx.beginPath();
  ctx.arc(11, 8, 2.5, Math.PI, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#785239';
  ctx.fillRect(7, 8, 8, 7);
  ctx.strokeRect(7.5, 8.5, 7, 6);
  ctx.restore();
}
