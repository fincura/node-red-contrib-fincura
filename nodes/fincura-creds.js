module.exports = function(RED) {
    "use strict";
    var request = require('request');

    function FincuraApiCredentialsNode(n) {
        RED.nodes.createNode(this,n);
    }

    RED.nodes.registerType("fincura-api-credentials", FincuraApiCredentialsNode, {
        credentials: {
            refresh_token: { type: "password"},
            tenant_id: { type: "text"},
            environment: { type: "text"}
        }
    });
}