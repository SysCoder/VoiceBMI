const functions = require('firebase-functions');
const ActionsSdkApp = require('actions-on-google').ActionsSdkApp;
const calcBmi = require('bmi-calc');
const dashbot = require('dashbot')("xxxxx").generic;
const LUISClient = require("./luis_sdk");

const APPID = "xxxxx";
const APPKEY = "xxxxx";

var LUISclient = LUISClient({
  appId: APPID,
  appKey: APPKEY,
  verbose: true
});

const UNIT_WEIGHT = 'unit-weight';
const UNIT_LENGTH = 'unit-length';

let appValues = {};

// // Create and Deploy Your First Cloud Functions
// // https://firebase.google.com/docs/functions/write-firebase-functions
//
exports.voiceBMI = functions.https.onRequest((req, res) => {
   //console.log('Request headers: ' + JSON.stringify(req.headers));
   //console.log('Request body: ' + JSON.stringify(req.body));
   const app = new ActionsSdkApp({request: req, response: res});
   if (!app.getArgument("is_health_check")) {
     const messageForDashbot = {
        "text": app.getRawInput(),
        "userId": app.getUser().userId,
        "conversationId": app.getConversationId(),
      };
      dashbot.logIncoming(messageForDashbot);

   }
     // Create functions to handle requests here
   let actionMap = new Map();

   actionMap.set(app.StandardIntents.MAIN, mainIntent);
   actionMap.set(app.StandardIntents.TEXT, respond);

   app.handleRequest(actionMap);
});

function mainIntent (app) {
  let inputPrompt = app.buildInputPrompt(false,
    'Hi, this is Voice BMI. What\'s your height and weight?');
  app.ask(inputPrompt);
}

function askWeightHeight (app) {
  let inputPrompt = app.buildInputPrompt(false,
    'Please tell me your height and weight.');
  app.ask(inputPrompt);
}

function exitApp (app) {
  app.tell('Thanks for using Voice BMI. Goodbye!');
}

function helpApp (app) {
  let inputPrompt = app.buildInputPrompt(false,
    'I can calculate a body mass index given height and weight. You can tell me in both metric and '
    + 'the imperial system. As example: "I am 5 feet 7 inches and weigh 175 '
    + 'pounds" or " 79.5 kilos 170.18 centimeters." Want me to calculate a BMI for you?');
  app.ask(inputPrompt);
}

function respond (app) {
  let transformedRawInput = transformRecognition(app.getRawInput());

  console.log("transformRecognition: " + transformedRawInput);
  if (transformedRawInput.includes("stone")) {
    app.ask("BMI currently does not support units in stones. Please use pounds.")
  }
  // Help
  if (transformedRawInput.includes("help")
    || transformedRawInput.includes("what can i do")
    || transformedRawInput.includes("how does this work")
    || transformedRawInput.includes("commands")) {
    helpApp(app);
  }
   //console.log("The right before exit if statement: " + transformedRawInput);
  // Exit
  if (transformedRawInput.includes("bye")
    || transformedRawInput.includes("no")
    || transformedRawInput.includes("ank you")
    || transformedRawInput.includes("exit")
    || transformedRawInput.includes("cancel")
    || transformedRawInput.includes("leave")) {
    exitApp(app);
    return;
  }

  // Ask for weight and height again.
  if (transformedRawInput.includes("yes")
    || transformedRawInput.includes("yeah")
    || transformedRawInput.includes("sure")
    || transformedRawInput.includes("do it")
    || transformedRawInput.includes("exactly")
    || transformedRawInput.includes("confirm")
    || transformedRawInput.includes("of course")
    || transformedRawInput.includes("sounds good")
    || transformedRawInput.includes("that's correct")
    || transformedRawInput.includes("i don't mind")
    || transformedRawInput.includes("i agree")) {
    askWeightHeight(app);
  }


  console.log("Feet Inches utterence: " + transformedRawInput);
  let parsedDataFromRegex = parseUsingRegex(transformedRawInput);
  //console.log("From REGEX: " + JSON.stringify(parsedDataFromRegex));
  //console.log("From Context: " + JSON.stringify(app.data));
  console.log("Data from state: " + JSON.stringify(app.getDialogState()));
  console.log("Data from Regex: " + JSON.stringify(parsedDataFromRegex));
  let heightWeightData = mergeHeightWeightData(app.getDialogState().data, parsedDataFromRegex);
  console.log("Merged from state: " + JSON.stringify(heightWeightData));
  app.data = heightWeightData;

  let missingData = whatIsMissing(heightWeightData);
  if (missingData.length == 2
    || transformedRawInput.match(/(\d{4,})/)
    || (!transformedRawInput.match(/([a-zA-Z]+)/) && pullOutNumbers(transformedRawInput).length > 3)) {
      // Look for cases like "58190 lb" and 62204 lbs" first.
    let likleyImperialValues = likelyImperialValues(transformedRawInput);
    let feet = likleyImperialValues.feet;
    let inches = parseInt(likleyImperialValues.inches) ? likleyImperialValues.inches + " " : " ";
    let pounds = likleyImperialValues.pounds;
    let feetInchesPoundsSeparated = feet + " "  + inches + " " + pounds + " pounds";
    if (likleyImperialValues.numberOfValidBMIs === 1) {
      let parsedDataFromRegex = parseUsingRegex(feetInchesPoundsSeparated);
      // Merging and testing for missing data is not need here because
      // if weight and height was derived from just numbers, both weight and
      // and height is needed.
      generateResponse(app, parsedDataFromRegex);
    } else {
      couldNotUnderstandResponse(app);
    }
  } else if (missingData.length == 1) {
    app.ask("What is your " + missingData[0] + "?");
    return;
  }
  generateResponse(app, heightWeightData);

}

function mergeHeightWeightData(firstHeightWeightData, secondHeightWeightData) {
  let reVal = {};
  if (firstHeightWeightData == null) {
    firstHeightWeightData = {};
  }
  if (secondHeightWeightData == null) {
    secondHeightWeightData = {};
  }
  reVal.height = firstHeightWeightData.height;
  reVal.weight = firstHeightWeightData.weight;

  if (secondHeightWeightData.height != undefined) {
    reVal.height = secondHeightWeightData.height;
  }
  if (secondHeightWeightData.weight != undefined) {
    reVal.weight = secondHeightWeightData.weight;
  }

  return reVal;
}

function parseLuisResponse(luisResponse) {
  console.log("LUIS output: " + JSON.stringify(luisResponse));
  let heightWeightData = {};
  let numberOfNumbers = luisResponse.query.replace(".", "").match(/[0-9]{1,}/g).length;
  for (var i = 0; i < 2 && i < numberOfNumbers; i++) {
    let entity = luisResponse.entities[i];
    if (entity.type === "Height - Imperial") {
      let height = {}
      height.value = entity.resolution.values[0];
      height.unit = entity.entity.split(' ')[1].toLowerCase();
      height.position = parseInt(entity.startIndex);
      heightWeightData.height = height;
    } else if (entity.type.includes("Weight")) {
      let weight = {};
      entity.entity =  entity.entity.replace(" . ", ".");
      weight.value = parseFloat(entity.entity.split(' ')[0]);
      weight.unit = entity.entity.split(' ')[1].toLowerCase();
      weight.position = parseInt(entity.startIndex);
      heightWeightData.weight = weight;
    } else if (entity.type.includes("Height")) {
      let height = {};
      entity.entity = entity.entity.replace(" . ", ".");
      height.value = parseFloat(entity.entity.split(' ')[0]);
      height.unit = entity.entity.split(' ')[1].toLowerCase();
      height.position = parseInt(entity.startIndex);
      heightWeightData.height = height;
    }
  }
  return heightWeightData;
}


function generateResponse(app, heightWeightData) {
  let confirmationResponse = generateConfirmation(heightWeightData);
  let calculateResult = calculateBmi(heightWeightData);
  let bmi = Math.round(calculateResult.value * 10) / 10;
  let category = calculateResult.name.toLowerCase();
  let response = "At " + confirmationResponse + " "
      + 'your BMI is ' + bmi + '. You are in the ' + category + ' category. '
      + 'Do you want me to calculate another BMI?';
  const messageForDashbot = {
     "text": response,
     "userId": app.getUser().userId,
     "conversationId": app.getConversationId(),
   };
   dashbot.logOutgoing(messageForDashbot);
  app.ask(response);
}

function calculateBmi(heightWeightData) {
   let heightInInches = 0;
   let weightInPounds = 0;
   if ((!heightWeightData.height.unit.includes("foot")
           && !heightWeightData.height.unit.includes("feet"))
       && heightWeightData.height.unit.includes("inch")) {
     heightInInches += parseFloat(heightWeightData.height.value);
   } else if (heightWeightData.height.unit.includes("inch")) {
     let valuesSplit = heightWeightData.height.value.split(' ');
     heightInInches += parseFloat(valuesSplit[0]) * 12;
     if (valuesSplit[1]) {
       heightInInches += parseFloat(valuesSplit[1]);
     }
   }
   if (heightWeightData.height.unit == "meters"
       || heightWeightData.height.unit == "meter"
       || heightWeightData.height.unit == "m" ) {
     heightInInches += heightWeightData.height.value * 39.3701;
   }
   if (heightWeightData.height.unit.includes("centi")
       || heightWeightData.height.unit.includes("centis")
       || heightWeightData.height.unit.includes("centimeter")
       || heightWeightData.height.unit.includes("centimeters")) {
     heightInInches += heightWeightData.height.value * 0.393701;
   }

   // Kilogram and kilos
   if (heightWeightData.weight.unit.includes("kilo")
     || heightWeightData.weight.unit.includes("kg")) {
     weightInPounds += heightWeightData.weight.value * 2.20462;
   }

   // Lb and lbs
   if (heightWeightData.weight.unit.includes("lb")
     || heightWeightData.weight.unit.includes("pound")) {
     weightInPounds += heightWeightData.weight.value;
   }
   // console.log("Calculate BMI: " + heightInInches + " " + weightInPounds);
   return calcBmi(weightInPounds, heightInInches, true)
}



function couldNotUnderstandResponse(app) {
  app.ask("I didn't quite understand the height and weight you told me. If you "
      + "haven't already, try again with the units like kilograms, pounds, and feet.");
}


function pullOutNumbers(inputText) {
  return inputText.split('').filter(function(val) {return !isNaN(val) && val != " "}).join('');
}


// When I get cases like "58190 lb", "62203 pounds" and "41170 pounds" and the NLU will have
// trouble parsing, this will work well.
function likelyImperialValues(utterence) {
  var likelyMetrics = {};
  //console.log(utterence);
  let pulledOutNumbers = utterence.split('').filter(function(val) {return !isNaN(val) && val != " "}).join('');
  //console.log(pulledOutNumbers)

  let maxDistenceFromMean = 20;
  for (let i = 0;i <= pulledOutNumbers.length;i++) {
    for(let j = i;j <= pulledOutNumbers.length;j++) {
       let feet = parseInt(pulledOutNumbers.substring(0,i));
       //console.log("Feet: " + feet);
       let inches = parseInt(pulledOutNumbers.substring(i,j));
       //console.log("Inches: " + inches);
       let pounds = parseInt(pulledOutNumbers.substring(j));
       if (inches > 11) {
         continue;
       }
       if (feet > 10) {
         continue;
       }

       if (isNaN(inches)) {
         inches = 0;
       }

       if (isNaN(feet)) {
         feet = 0;
       }

       if (isNaN(pounds)) {
         pounds = 0;
       }
       //console.log("Pounds: " + pounds);
       let distence = Math.abs(calcBmi(pounds, feet * 12 + inches, true).value - 27);
       if (maxDistenceFromMean > distence) {
         likelyMetrics.feet = feet;
         likelyMetrics.inches = inches;
         likelyMetrics.pounds = pounds;
         if (likelyMetrics.numberOfValidBMIs) {
           likelyMetrics.numberOfValidBMIs += 1;
         } else {
           likelyMetrics.numberOfValidBMIs = 1;
         }
         //console.log(likelyMetrics);
       }
    }
  }
  return likelyMetrics;
}

function transformRecognition(utterence) {
  // Take care of cases like 39cm
  utterence = utterence.replace(/\bcm\b/," centimeters");
  utterence = utterence.replace(/\bft\b/,"feet");
  utterence = utterence.replace(/\bin\b/,"inches");
  utterence = utterence.replace(/\bfans\b/,"pounds");
  utterence = utterence.replace(/\bone\b/,"1");
  utterence = utterence.replace(/\bto\b/,"2");
  utterence = utterence.replace(/\btoo\b/,"2");
  utterence = utterence.replace(/\btwo\b/,"2");
  utterence = utterence.replace(/ - /," 2 ");
  utterence = utterence.replace(/-/," ");
  utterence = utterence.replace(/\bthree/,"3");
  utterence = utterence.replace(/\bfor\b/,"4");
  utterence = utterence.replace(/\bfour\b/,"4");
  utterence = utterence.replace(/\bor\b/,"4");
  utterence = utterence.replace(/\bbore\b/,"4");
  utterence = utterence.replace(/\bfive\b/,"5");
  utterence = utterence.replace(/\bdrive\b/,"5");
  utterence = utterence.replace(/\bV\b/,"5");
  utterence = utterence.replace(/\bby\b/,"5");
  utterence = utterence.replace(/\bHi\b/,"5");
  utterence = utterence.replace(/\bbuy\b/,"5");
  utterence = utterence.replace(/\bsix\b/,"6");
  utterence = utterence.replace(/\bsex\b/,"6");
  utterence = utterence.replace(/\bseven\b/,"7");
  utterence = utterence.replace(/\bate\b/,"8");
  utterence = utterence.replace(/\beight\b/i,"8");
  utterence = utterence.replace(/\bnine\b/,"9");
  utterence = utterence.replace(/\bten\b/,"10");
  utterence = utterence.replace(/\beleven\b/,"11");
  utterence = utterence.replace(/\btwelve\b/,"12");
  utterence = utterence.replace(/\bpanels\b/,"pounds");
  utterence = utterence.replace(/\bth\b/,"");
  utterence = utterence.replace(/  /," ");
  return utterence.toLowerCase();
}




// Tell you if height or weight is missing.
function whatIsMissing(heightWeightData) {
  let reVal = [];
  if (heightWeightData.weight == undefined || heightWeightData.weight == null) {
    reVal.push('weight');
  }
  if (heightWeightData.height == undefined || heightWeightData.height == null) {
    reVal.push('height');
  }
  return reVal;
}


// Generates a negative confirmation the way the user spoke to the system.
// E.g.
// "I am 5 7 and I weigh 180 pounds" -> "At 5 7 180 pounds"
// "180 pounds I stand very tall at 1.8 meters" -> "At 180 pounds 1.8 meters"
// "I am 175 centimeters 80 kilos" -> "At 175 centimeters 80 kilos"
// TODO: Fix errors when only weight or height is provided.
function generateConfirmation(heightWeightData) {
  let heightGeneratedText = "";
  if (heightWeightData.height.unit.includes("feet") || heightWeightData.height.unit.includes("foot")) {
    heightGeneratedText = generateFeetInchesConfirmation(heightWeightData.height);
  } else {
    heightGeneratedText = heightWeightData.height.value + " " + heightWeightData.height.unit + " ";
  }
  let weightGeneratedText = heightWeightData.weight.value + " " + heightWeightData.weight.unit + " ";

  let reVal = "";
  //console.log(heightWeightData.weight.position );
  //console.log(heightWeightData.height.position );

  if (heightWeightData.weight.position > heightWeightData.height.position) {
    reVal = heightGeneratedText + " and " + weightGeneratedText.trim();
  } else {
    reVal = weightGeneratedText + " and " + heightGeneratedText.trim();
  }
  return reVal.replace("  ", " ");
}

function generateFeetInchesConfirmation(footInchesWeightData) {
  let feet = footInchesWeightData.value.split(' ')[0] ? footInchesWeightData.value.split(' ')[0] : "";
  let feetUnit = footInchesWeightData.unit.split(' ')[0] ? footInchesWeightData.unit.split(' ')[0] : "";
  let inches = footInchesWeightData.value.split(' ')[1] ? footInchesWeightData.value.split(' ')[1] : "";
  let inchesUnit = footInchesWeightData.unit.split(' ')[1] ? footInchesWeightData.unit.split(' ')[1] : "";

  if (footInchesWeightData.unit === "foot inches" || footInchesWeightData.unit === "feet inches") {
    let inchesText = generateInchText(footInchesWeightData.value.split(' ')[1]);
    return feet + " " + feetUnit + " " + inchesText + " ";
  } else if (footInchesWeightData.unit === "foot implicit inches"
      || footInchesWeightData.unit === "feet implicit inches") {
    return feet + " " + feetUnit + " " + inches + " ";
  } else if (footInchesWeightData.unit === "implicit feet implicit inches"
      || footInchesWeightData.unit === "implicit foot implicit inches") {
    return feet + " " + inches + " ";
  } else if (footInchesWeightData.unit === "inches") {
    return generateInchText(inches) + " ";
  }
}

function generateInchText(inches) {
  let inchesText = "";
  let inchesNumber = parseInt(inches);
  if (!isNaN(inchesNumber) && inchesNumber > 0) {
    if (inchesNumber == 1) {
      inchesText = "1 inch";
    } else {
      inchesText = inchesNumber + " inches";
    }
  }
  return inchesText;
}



function parseWeightHeightImperialData(luisResponse) {
  let imperialValues = {};
  for (var i = 0; i < 2 && i < luisResponse.entities.length; i++) {
    let entity = luisResponse.entities[i];
    if (entity.type === "Weight - Imperial") {
      imperialValues.pounds = parseInt(pullOutNumbers(entity.entity));
    } else if (entity.type === "Height - Imperial") {
      let feetInchesSplit = entity.resolution.values[0].split(' ');
      imperialValues.feet = parseInt(feetInchesSplit[0]);
      if (feetInchesSplit.length > 1) {
        imperialValues.inches = parseInt(feetInchesSplit[1]);
      }
    }
  }
  return imperialValues;
}

function parseWeightHeightMetricData(luisResponse) {
  let metricValues = {};
  for (var i = 0; i < 2 && i < luisResponse.entities.length; i++) {
    let entity = luisResponse.entities[i];
    if (entity.type === "Weight - Metric") {
      metricValues.kilos = parseInt(pullOutNumbers(entity.entity));
    } else if (entity.type === "Height - Metric") {
      if (entity.entity.toLowerCase().includes(" m")) {
        let metersParsed = entity.entity.replace(' ', '').replace(' ', '').split('m')[0];
        //console.log("Meters parsed: " + metersParsed);
        metricValues.centimeters = parseFloat(metersParsed) * 100;
      } else {
        metricValues.centimeters = parseInt(pullOutNumbers(entity.entity));
      }
    }
  }
  return metricValues;
}

function parseUsingRegex(utterence) {
  let heightWeightData = {};

  let kilogramData = findKilograms(utterence);
  if (kilogramData.value) {
    heightWeightData.weight = kilogramData;
    utterence = utterence.replace(kilogramData.matchedValue, '');
  }
  let meterData = findMeters(utterence);
  if (meterData.value) {
    heightWeightData.height = meterData;
    utterence = utterence.replace(meterData.matchedValue, '');
  }
  let centimeterData = findCentimeters(utterence);
  if (centimeterData.value) {
    heightWeightData.height = centimeterData;
    utterence = utterence.replace(centimeterData.matchedValue, '');
  }
  let poundData = findPounds(utterence);
  if (poundData.value) {
    heightWeightData.weight = poundData;
    utterence = utterence.replace(poundData.matchedValue, '');
  }
  let feetInchesData = findFeetInches(utterence);
  if (feetInchesData.value) {
    heightWeightData.height = feetInchesData;
  }

  // Fix text to speech "5 198 pounds" to "5 1 98 pounds"
  // This is commonly a misinterpretation of the text to speech engine.
  // Normally, people do not say "5 198 pounds," they would say
  // "5 feet 198 pounds."
  heightWeightData = fixTTSConfusion(heightWeightData);
  return heightWeightData;
}

function fixTTSConfusion(heightWeightData) {
  if (heightWeightData.height != undefined
      && heightWeightData.weight != undefined
      && heightWeightData.height.unit == "implicit feet implicit inches"
      && heightWeightData.height.value.trim().length == 1
      && heightWeightData.weight.value >= 110
      && heightWeightData.weight.value <= 199) {
     heightWeightData.height.value += " 1";
     heightWeightData.weight.value = heightWeightData.weight.value % 100;
  }
  return heightWeightData;
}

function findKilograms(utterence) {
  var re = /(\d*\.?\d+)\s*(kilograms|kilos|kilo|kg)/ig;
  return insertIntoDataStructure(re.exec(utterence));
}

function findMeters(utterence) {
  var re = /(\d*\.?\d+)\s*(meters|meter|m)/ig;
  return insertIntoDataStructure(re.exec(utterence));
}

function findCentimeters(utterence) {
  var re = /(\d*\.?\d+)\s*(centimeters|centimeter|cm|centis)/ig;
  return insertIntoDataStructure(re.exec(utterence));
}

function findPounds(utterence) {
  var re = /(\d*\.?\d+)\s*(pounds|pound|lbs|lb)/ig;
  return insertIntoDataStructure(re.exec(utterence));
}

function insertIntoDataStructure(resultFromRegex) {
  let dataStructure = {};
  if (resultFromRegex) {
    dataStructure.value = parseFloat(resultFromRegex[1]);
    dataStructure.unit = resultFromRegex[2];
    dataStructure.position = resultFromRegex.index;
    dataStructure.matchedValue = resultFromRegex[0];
  }
  return dataStructure;
}

function findFeetInches(utterence) {
  let re = /([1-9])\s*(feet|foot)?\s*(1[0-2]|[1-9])?\s*(inches|inch)?/i;
  let resultFromRegex = re.exec(utterence);

  if (!resultFromRegex) {
    re = /([1-9])\s*(feet|foot)?\s*(1[0-2]|[1-9])?\s*(inches|inch)?/i;
    resultFromRegex = re.exec(utterence);
  }

  // console.log("Result from regex: " + resultFromRegex);
  let dataStructure = {};
  if (resultFromRegex) {
    let resultFromRegexJustNumbers = resultFromRegex[0].match(/\d+/ig);
    // console.log(resultFromRegexJustNumbers);
    // console.log(resultFromRegex);
    let grabbedFeet = resultFromRegex[1] !== undefined ? resultFromRegex[1] : "";
    let grabbedInches = resultFromRegex[3] !== undefined ? resultFromRegex[3] : "";
    dataStructure.value = (grabbedFeet + " " + grabbedInches).trim();

    // console.log(!resultFromRegex[0].includes("inch"))
    if (resultFromRegex[0].includes("feet") && resultFromRegex[0].includes("inch")) {
      dataStructure.unit = "feet inches";
    } else if (resultFromRegex[0].includes("feet") && !resultFromRegex[0].includes("inch")) {
      dataStructure.unit = "feet implicit inches";
    } else if (resultFromRegex[0].includes("foot") && resultFromRegex[0].includes("inch")) {
      dataStructure.unit = "foot inches";
    } else if (resultFromRegex[0].includes("foot") && !resultFromRegex[0].includes("inch")) {
      dataStructure.unit = "foot implicit inches";
    } else if (!resultFromRegex[0].includes("foot")
        && !resultFromRegex[0].includes("feet")
        && resultFromRegex[0].includes("inch")) {
      dataStructure.unit = "inches";
    } else {
      dataStructure.unit = "implicit feet implicit inches";
    }
    dataStructure.position = resultFromRegex.index;
    dataStructure.matchedValue = resultFromRegex[0];
  }
  return dataStructure;
}
