const locations = [
  { name: '九龙 黄慕兰寓所', x: 22, y: 43, description: '第一地点：危险预警、线索整理与掩护出发。', state: '本期制作' },
  { name: '香港 铜锣湾避风塘', x: 57, y: 68, description: '第二地点：核对联络信息、协助分批登船。', state: '本期制作' },
  { name: '惠阳／惠州', x: 70, y: 28, description: '后续内容：接应与转交情报。', state: '后续内容' },
  { name: '曲江 今韶关', x: 45, y: 18, description: '后续内容：接待与任务分配。', state: '后续内容' },
  { name: '桂林', x: 16, y: 17, description: '后续内容：后方安全区。', state: '后续内容' },
];
const container = document.querySelector('#locations');
locations.forEach((location, index) => {
  const button = document.createElement('button');
  button.className = `location ${index > 1 ? 'future' : ''}`;
  button.style.left = `${location.x}%`;
  button.style.top = `${location.y}%`;
  button.textContent = `${index + 1} ${location.name}`;
  button.addEventListener('click', () => {
    document.querySelector('#location-title').textContent = location.name;
    document.querySelector('#location-description').textContent = `${location.state}。${location.description}`;
  });
  container.append(button);
});
