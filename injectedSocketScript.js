// variable names
let currentMap = [];
let currentFieldID = 0;
let currentIslandID = 0;
let currentOwner = "";
let currentRegion = "";
let summonInterval = null;

//----------------------------------------------------summon-all---------------------------------------------------\\
let StateOFSummon = undefined;

// Listen for forwarded messages from contentScript.js
window.addEventListener("message", (event) => {
	if (event.source !== window) return; // Only accept messages from the same window
	if (event.data.type === "SUMMON_ALL") {
		StateOFSummon = event.data.summonAll;
		//console.log("Injected script received StateOFSummon:", StateOFSummon);
	}
});
// function to be later interavaled
function summonAllMain() {
	//Ading a event listener to UPDATE_FIELD socket event and updating variables based on last field pressed
	if (
		!window.$socket._callbacks.$UPDATE_FIELD ||
		window.$socket._callbacks.$UPDATE_FIELD.filter(
			(f) => f.name === "updateFieldIndex"
		).length === 0
	) {
		window.$socket.on("UPDATE_FIELD", function updateFieldIndex(e) {
			currentFieldID = e.index;
			currentIslandID = e.islandIndex;
			currentOwner = e.owner;
		});
	}

	// Ading a event listener to UPDATE_MAP socket event and updating variables based on last island entered
	if (
		!window.$socket._callbacks.$UPDATE_MAP ||
		window.$socket._callbacks.$UPDATE_MAP.filter(
			(f) => f.name === "updateCurrentMap"
		).length === 0
	) {
		window.$socket.on("UPDATE_MAP", function updateCurrentMap(e) {
			currentMap = e;
			let regionView = undefined
			e.forEach((field) => {
				//looking for portal field and extracting its region data
				if (field.nature !== "portal") {
					regionView = false
					currentIslandID = field.islandIndex
				} else {
					currentRegion = field.region
					if (regionView !== false) {
						regionView = true
					}
				}
			});
			if (regionView === true) currentIslandID = 0;
		});
	}
	// checking if current gamestate has any fieldwindow opened if so adding a button to summon troops, the div is needed for styling
	const fieldWindow = document.querySelector("div.field.window");
	if (StateOFSummon === "true" || StateOFSummon === true) {
		if (fieldWindow) {
			let summonButton = document.querySelector("#summonButton");
			if (!summonButton) {
				const outerDiv = document.createElement("div");
				outerDiv.classList.add("flex", "ai-c", "jc-c");

				summonButton = document.createElement("div");
				summonButton.classList.add("button", "blue");
				summonButton.id = "summonButton";
				summonButton.style.marginTop = "15px";
				summonButton.style.marginBottom = "15px";
				if (summonInterval) summonButton.innerHTML = "Stop Summon";
				else summonButton.innerHTML = "Summon Troops";

				outerDiv.append(summonButton);
				fieldWindow.append(outerDiv);
				// on button click executing the funtion for
				summonButton.addEventListener("click", () => {
					if (summonInterval) {
						clearInterval(summonInterval);
						summonInterval = null;
						summonButton.innerHTML = "Summon Troops";
						if (currentIslandID !== 0 && currentRegion !== "") {
							window.$socket.emit("CONNECT_MAP", {
								region: currentRegion,
								islandIndex: currentIslandID,
							});
						}
					} else {
						summonButton.innerHTML = "Stop Summon";
						summonAllTroops(
							currentFieldID,
							currentIslandID,
							currentOwner,
							currentMap,
							currentRegion
						);
					}
				});
			}
		}
	}
}

function summonAllTroops(
	summonFieldID,
	summonIslandID,
	summonOwner,
	summonMap,
	summonRegion
) {
	i = 0;

	//sending troops every 600ms, because the game doesn't like it when its faster than that
	const sendTroops = setInterval(() => {
		let field = summonMap[i];
		if (i >= summonMap.length) {
			let summonButton = document.getElementById("summonButton");
			if (summonButton) summonButton.innerText = "Summon Troops";
			clearInterval(summonInterval);
			summonInterval = null;
			window.$socket.emit("CONNECT_MAP", {
				region: summonRegion,
				islandIndex: summonIslandID,
			});
		}
		//Checking if there are any units of specific type on the field and roudning the value to later add to our request
		let units = field.units
			.filter((unit) => unit.amount >= 1 && unit.owner === summonOwner)
			.map((unit) => ({ ...unit, amount: Math.floor(unit.amount) }));
		// not wasting any interval ticks by iterating through fields untill some has any troops
		while (
			(units.length === 0 || summonFieldID === field.index) &&
			i < summonMap.length
		) {
			i++;
			field = summonMap[i];
			units = field.units
				.filter(
					(unit) => unit.amount >= 1 && unit.owner === summonOwner
				)
				.map((unit) => ({ ...unit, amount: Math.floor(unit.amount) }));
		}
		// Sending the request using RiT socket
		if (units.length !== 0 && summonFieldID !== field.index) {
			window.$socket.emit(
				"PUT_MOVE",
				{
					units: units,
					field1: field.index,
					field2: summonFieldID,
					island: summonIslandID,
					layer: 1,
					moveIntent: "defend",
					launchedAt: window.$ping / 2,
					wasSentBlindly: false,
				},
				() => {
					"sent";
				}
			);
		}
		i++;
	}, 600);
	summonInterval = sendTroops;
}
//-----------------------------------------------auto-reroll-------------------------------------------\\
let newUnits = [];
let newRecruitingLevels = undefined;
let newMiningLevels = undefined;
let AllowedUnits = [];
let minRecruitingLevels = undefined;
let minMiningLevels = undefined;
let reroll_val_interval = 0;
let can_reroll = false;

let StateOFReroll = undefined;

// Listen for forwarded messages from contentScript.js
window.addEventListener("message", (event) => {
	if (event.source !== window) return; // Only accept messages from the same window
	if (event.data.type === "REROLL_ALL") {
		StateOFReroll = event.data.RerollAll;
	}
});

function reroll() {
	if (
		newRecruitingLevels == undefined ||
		newMiningLevels == undefined ||
		minMiningLevels == undefined ||
		minRecruitingLevels == undefined ||
		newUnits.length == 0 ||
		AllowedUnits.length == 0
	) {
		can_reroll = false;
	} else {
		can_reroll = true;
	}
	let unitMatch = newUnits.some((unit) => AllowedUnits.includes(unit));
	let levelsMet =
		parseInt(newRecruitingLevels) >= parseInt(minRecruitingLevels) &&
		parseInt(newMiningLevels) >= parseInt(minMiningLevels);
	//only send the correct data when reroll_val_interval is odd num so it skips even nums
	if (reroll_val_interval % 2 !== 0) {
		if ((!unitMatch || !levelsMet) && isAutoRerolling && can_reroll) {
			if (
				!window.$socket._callbacks.$UPDATE_FIELD ||
				window.$socket._callbacks.$UPDATE_FIELD.filter(
					(f) => f.name === "updateFieldIndex"
				).length === 0
			) {
				window.$socket.on("UPDATE_FIELD", function updateFieldIndex(e) {
					currentFieldID = e.index;
					currentIslandID = e.islandIndex;
					currentOwner = e.owner;
				});
			}

			//const switch_item = fieldWindow.querySelector('div.switch-element.active')

			window.$socket.emit("PUT_FIELD_UPGRADE_REROLL", {
				placeIndex: currentFieldID,
				islandIndex: currentIslandID,
			});
		}
	}
}
let isAutoRerolling = false; // Flag to control reroll loop

function AutoReroll() {
	setTimeout(() => {
		sendDataToContentScript({ message: "SENDdata" });
	}, 200);
	// console.log(
	// 	newUnits,
	// 	AllowedUnits,
	// 	newRecruitingLevels,
	// 	minRecruitingLevels,
	// 	newMiningLevels,
	// 	minMiningLevels
	// );
	//onst unitMatch = newUnits.some((unit) => AllowedUnits.includes(unit));
	//console.log(unitMatch);
	function sendDataToContentScript(data) {
		// Send a message to contentScript.js using window.postMessage
		window.postMessage({ type: "RerollData", data: data }, "*");
		console.log("sent");
	}
	reroll();
}

// Function to stop auto reroll manually
function stopAutoReroll() {
	const autoRerollButton = document.getElementById("AutoRerollButton");
	if (autoRerollButton) {
		autoRerollButton.remove();
	}
	isAutoRerolling = false;
	console.log("Auto reroll stop requested.");
}

function AutoRerollRun() {
	const autoRerollButton = document.getElementById("AutoRerollButton");
	if (autoRerollButton) {
		autoRerollButton.remove();
	}
	isAutoRerolling = true;
	sendDataToContentScript({ message: "SENDdata" });
}

function sendDataToContentScript(data) {
	// Send a message to contentScript.js using window.postMessage
	window.postMessage({ type: "RerollData", data: data }, "*");
	console.log("sent");
}
// Listen for messages from contentScript.js
window.addEventListener("message", (event) => {
	// Only accept messages from the same window context
	if (event.source !== window) return;

	// Check for the specific message type
	if (event.data && event.data.type === "REROLL_VAL_DATA") {
		const receivedData = event.data.data;
		console.log("Received data from content script:", receivedData);

		// Process the data as needed
		handleRerollData(receivedData);
	}
});

function handleRerollData(data) {
	newUnits = data.unitClasses;
	console.log("Unit Classes:", newUnits);
	newRecruitingLevels = data.recruitingLevels;
	console.log("Recruiting Levels:", newRecruitingLevels);
	newMiningLevels = data.miningLevels;
	console.log("Mining Levels:", newMiningLevels);
	let unitMatch = newUnits.some((unit) => AllowedUnits.includes(unit));
	let levelsMet =
		parseInt(newRecruitingLevels) >= parseInt(minRecruitingLevels) &&
		parseInt(newMiningLevels) >= parseInt(minMiningLevels);
	reroll_val_interval++;
	if (!unitMatch || !levelsMet) {
		setTimeout(() => {
			AutoReroll();
		}, 0.25 * 1000);
	} else {
		isAutoRerolling = false;
	}
}
// Listen for messages from contentScript.js
window.addEventListener("message", (event) => {
	// Ensure the message comes from the same window
	if (event.source !== window) return;

	// Check for the specific message type
	if (event.data && event.data.type === "IMG_DATA_VALUES_FOR_INJECTED") {
		const dataValues = event.data.dataValues;
		console.log("Received data-values from content script:", dataValues);

		// Process the data-values as needed
		handleDataValuesFromContentScript(dataValues);
	}
});

// Function to handle the received data-values
function handleDataValuesFromContentScript(dataValues) {
	AllowedUnits = dataValues;
	dataValues.forEach((value) => {
		// Perform any required actions with each data-value
	});
}
// Listen for messages from contentScript.js
window.addEventListener("message", (event) => {
	if (event.source !== window) return;

	if (event.data && event.data.type === "DROPDOWN_VALUES_FOR_INJECTED") {
		const { minimumMiningAllowed, minimumRecruitingAllowed } =
			event.data.values;
		console.log("Received dropdown values from content script:");
		//console.log("Minimum Mining Allowed:", minimumMiningAllowed);
		//console.log("Minimum Recruiting Allowed:", minimumRecruitingAllowed);

		// Handle the received values as needed in injectedSocketScript.js
		handleDropdownValues(minimumMiningAllowed, minimumRecruitingAllowed);
	}
});

// Function to handle the received dropdown values
function handleDropdownValues(minMining, minRecruiting) {
	minMiningLevels = minMining;
	console.log("Handling minimum mining level:", minMiningLevels);
	minRecruitingLevels = minRecruiting;
	console.log("Handling minimum recruiting level:", minRecruitingLevels);
	// Add your processing logic here
}

function reroll_button() {
	if (StateOFReroll) {
		const fieldWindow = document.querySelector("div.field.window");
		if (fieldWindow) {
			let AutoRerollButton = document.querySelector("#AutoRerollButton");
			// Check for the div with class "switch-element active" containing the text "Upgrade"
			const switchElement = document.querySelector(
				".switch-element.active"
			);
			const containsUpgradeText =
				switchElement && switchElement.textContent.includes("Upgrade");

			// If the div contains the text "Upgrade", create the button if it doesn't exist
			if (containsUpgradeText) {
				if (!AutoRerollButton) {
					const outerDiv = document.createElement("div");
					outerDiv.classList.add("flex", "ai-c", "jc-c");

					AutoRerollButton = document.createElement("div");
					AutoRerollButton.classList.add("button", "blue");
					AutoRerollButton.id = "AutoRerollButton";
					AutoRerollButton.style.marginTop = "15px";
					AutoRerollButton.style.marginBottom = "15px";
					//AutoRerollButton.innerHTML = "Auto Reroll";
					if (isAutoRerolling) {
						console.log(isAutoRerolling);
						AutoRerollButton.innerHTML = "Stop Auto Reroll";
					} else if (!isAutoRerolling) {
						console.log(isAutoRerolling);
						AutoRerollButton.innerHTML = "Auto Reroll";
					}

					outerDiv.append(AutoRerollButton);
					fieldWindow.append(outerDiv);

					// Attach event listener to the button
					AutoRerollButton.addEventListener("click", () => {
						if (!isAutoRerolling) {
							AutoRerollRun();
						} else if (isAutoRerolling) {
							stopAutoReroll();
						}
					});
				}
			} else {
				// If the div does not contain the text "Upgrade", remove the button if it exists
				if (AutoRerollButton) {
					AutoRerollButton.remove();
					AutoRerollButton = null;
				}
			}
		}
	}
}
//---------------------------------------------flash island---------------------------------------------\\
let StateOfFlash = undefined;
let Region = { islands: {} };

// Listen for forwarded messages from contentScript.js
window.addEventListener("message", (event) => {
	if (event.source !== window) return; // Only accept messages from the same window
	if (event.data.type === "flash") {
		StateOfFlash = event.data.flash;
	}
});

function flashButton() {
	if (StateOfFlash) {
		//console.log("flash");
		// Wait for the DOM to load
		// Find the element with the class 'nav-element nav-infos'
		const navElement = document.querySelector(".nav-element.nav-infos");
		let button = document.querySelector(".flash-button");
		//console.log("flash");

		if (navElement && !button) {
			//console.log("flash");
			// Create a new button
			const button = document.createElement("button");
			button.textContent = "flash islands";
			//button.style.margin = "10px";
			button.style.padding = "5px 10px";
			button.classList.add("flash-button");
			button.style.cursor = "pointer";
			button.style.backgroundColor = "black"; // Transparent background
			button.style.color = "white"; // White text
			button.style.border = "2px solid white"; // White border
			button.style.borderRadius = "5px"; // Rounded corners
			button.style.fontSize = "14px"; // Font size

			// Add an event listener for the button
			button.addEventListener("click", () => {
				flashIslands(currentMap, currentRegion);
			});

			// Append the button to the navElement
			navElement.appendChild(button);
			//console.log("flash");
		} else {
			//console.warn("Element with class 'nav-element nav-infos' not found.");
		}
	}
}

function getPixelCoordinates(coordinate) {
	// Define grid settings
	const startX = 55; // Starting X coordinate for A1
	const startY = 15; // Starting Y coordinate for A1
	const tileWidth = 100; // Horizontal distance between numbers (1-20)
	const tileHeight = 100; // Vertical distance between letters (A-Z)
	let showOwner = false;
	portalCord = parseInt(coordinate);
	//console.log(isNaN(portalCord))
	//console.log(portalCord)
	if (isNaN(portalCord)) {
		showOwner = false;
	} else {
		showOwner = true;
	}
	//console.log(showOwner)
	// Parse the coordinate
	const column =
		coordinate[0].toLowerCase().charCodeAt(0) - "a".charCodeAt(0); // Column offset (Affects Y)
	//console.log
	const row = parseInt(coordinate.slice(1), 10) - 1; // Row offset (Affects X)

	// Calculate pixel coordinates
	const x = startX + row * tileWidth; // Adjust X by row offset
	const y = startY + column * tileHeight; // Adjust Y by column offset

	return { x, y, showOwner };
}

function logElementByTranslate(x, y, owner, showOwner) {
	const elements = document.querySelectorAll(".content.centered");

	for (const element of elements) {
		const inlineStyle = element.getAttribute("style");

		if (inlineStyle && inlineStyle.includes("transform")) {
			const matches = inlineStyle.match(
				/translate\(([-\d.]+)px, ([-\d.]+)px\)/g
			);

			if (matches) {
				const lastMatch = matches[matches.length - 1];
				const [, xVal, yVal] = lastMatch.match(
					/translate\(([-\d.]+)px, ([-\d.]+)px\)/
				);

				if (showOwner) {
					return owner;
				} else if (parseFloat(xVal) === x && parseFloat(yVal) === y) {
					return element.textContent.trim();
				}
			}
		}
	}

	// return undefined; // Explicit return if no match is found
}

function flashIslands(flashMap, flashRegion) {
	let i = 0;
	const flash = setInterval(() => {
		let owner_ = undefined;
		let island = flashMap[i];
		while (
			island &&
			(island.islandEventClass === "none" ||
				island.islandEventClass === null) &&
			i < flashMap.length
		) {
			i++;
			island = flashMap[i];
		}
		if (i >= flashMap.length) clearInterval(flash);

		window.$socket.emit("CONNECT_MAP", {
			region: flashRegion,
			islandIndex: island.index,
		});
		console.log(island);

		i++;
		setTimeout(() => {
			// Select the parent div with class "natures"
			const naturesDiv = document.querySelector(".natures");

			// Get all child elements inside the natures div
			const items = naturesDiv.querySelectorAll("*");

			// Iterate through each child element and log their class lists
			items.forEach((item) => {
				const field = [...item.classList].filter(
					(className) =>
						className !== "rpHints" && className !== "nature"
				);
				console.log(field, island.code, island.islandEventClass);
				// Logs an array of classes for each item
				if (field.length > 0) {
					console.log(field[0].replace(/^f-/, "")); // Log the modified class
					if (field[1] == "enemy") {
						console.log(
							getPixelCoordinates(field[0].replace(/^f-/, ""))
						);
						//console.log(
						owner_ = logElementByTranslate(
							getPixelCoordinates(field[0].replace(/^f-/, "")).x,
							getPixelCoordinates(field[0].replace(/^f-/, "")).y,
							island.owner,
							getPixelCoordinates(field[0].replace(/^f-/, ""))
								.showOwner
						);
						console.log(
							logElementByTranslate(
								getPixelCoordinates(field[0].replace(/^f-/, ""))
									.x,
								getPixelCoordinates(field[0].replace(/^f-/, ""))
									.y,
								island.owner,
								getPixelCoordinates(field[0].replace(/^f-/, ""))
									.showOwner
							)
						);
						//);
						//console.log(getPixelCoordinates(field[0].replace(/^f-/, "")).x);
						console.log(
							getPixelCoordinates(field[0].replace(/^f-/, "")).y
						);
					}
				}
				if (!Region.islands[island.code]) {
					Region.islands[island.code] = { fields: {} }; // Initialize the island object with a fields object
				}
				Region.islands[island.code].fields[
					field[0].replace(/^f-/, "")
				] = {
					coordinate: field[0].replace(/^f-/, ""),
					ownership: owner_ || "System",
				};
			});
		}, 900);
		//let Region = {islands : {}};
		//console.log(island)

	}, 1000);
	console.log(Region);
}
//---------------------------------------------add-book---------------------------------------------\\

// Add this function after the existing code

let bookEnabled = undefined;

window.addEventListener("message", (event) => {
	if (event.data.type === "book") {
		bookEnabled = event.data.book;
	}
});

function addBookButton() {
	if (!bookEnabled) return;

	const navElement = document.querySelector(".nav-element.nav-infos");
	let bookButton = document.querySelector(".book-button");

	if (navElement && !bookButton) {
		// Create a new button
		const button = document.createElement("button");
		button.textContent = "📖";
		button.classList.add("book-button");
		button.style.cursor = "pointer";
		button.style.backgroundColor = "#000";
		button.style.color = "white";
		button.style.border = "2px solid white";
		button.style.borderRadius = "5px";
		button.style.fontSize = "25px";
		button.style.marginLeft = "10px";

		// Request guide URL through messaging
		button.addEventListener("click", () => {
			window.postMessage({ type: "GET_GUIDE_URL" }, "*");
		});

		navElement.appendChild(button);
	}
}

// Add URL response listener
window.addEventListener("message", (event) => {
	if (event.data.type === "GUIDE_URL_RESPONSE") {
		window.open(event.data.url, '_blank');
	}
});
//---------------------------------------------auto skill tree---------------------------------------------\\
function skilltree(skillId) {
	// Check if the UPDATE_FIELD event listener is already registered
	if (
		!window.$socket._callbacks.$UPDATE_FIELD ||
		window.$socket._callbacks.$UPDATE_FIELD.filter(
			(f) => f.name === "updateFieldIndex"
		).length === 0
	) {
		// Register the UPDATE_FIELD event listener
		window.$socket.on("UPDATE_FIELD", function updateFieldIndex(e) {
			currentFieldID = e.index; // Update the current field ID
			currentIslandID = e.islandIndex; // Update the current island ID
			currentOwner = e.owner; // Update the current owner
		});
	}
	// Emit the PUT_SKILL event to activate the 20th skill
	window.$socket.emit("PUT_SKILL", {
		islandIndex: currentIslandID, // Current island ID
		placeIndex: currentFieldID, // Current field ID
		skillNumber: skillId // Skill number to activate
	});
}

window.addEventListener("message", (event) => {
  if (event.source !== window) return; // only accept messages from same page

  const msg = event.data;
  if (msg?.type === "CALL_SKILLTREE" && Array.isArray(msg.ids)) {
    if (typeof window.skilltree === "function") {
      activateSkillsSequentially(msg.ids);
    } else {
      console.warn("skilltree() not available on window");
    }
  }
});

async function activateSkillsSequentially(ids) {
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    try {
      window.skilltree(id);
      console.log(`skilltree(${id}) executed successfully`);
    } catch (err) {
      console.error(`skilltree(${id}) failed:`, err);
    }
    await delay(70);
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
//---------------------------------------------run---------------------------------------------\\
flashButton();
function run() {
	if (currentIslandID === 0) {
		flashButton();
	} else {
		let flashButton_ = document.querySelector(".flash-button");
		if (flashButton_) {
			flashButton_.remove();
		}
	}
	summonAllMain();
	reroll_button();
	if (bookEnabled) addBookButton();
}
setInterval(run, 200);
