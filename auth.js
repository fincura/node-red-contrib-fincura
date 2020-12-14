var when = require("when");
var request = require("request");

var FincuraApi = require('fincura_api');

var ensureAccessToken = function(fincura_credentials){
    return when.promise(function(resolve) {
        if(fincura_credentials){
            var tenantId =  fincura_credentials.tenant_id;
            var refreshToken = fincura_credentials.refresh_token;
            var fincura_env = fincura_credentials.environment;
        } else {
            var tenantId =  process.env.FINCURA_TENANT_ID;
            var refreshToken = process.env.FINCURA_API_REFRESH_TOKEN;
            var fincura_env = process.env.FINCURA_ENV || 'production';
        }   

        let host = "https://api.fincura.com";

        if ( fincura_env == 'local' ) {
            host = "https://api-local.fincura.com:8000";
        } else if (fincura_env != 'production') {
            host = `https://api-${fincura_env}.fincura.com`;
        }

        var defaultClient = FincuraApi.ApiClient.instance;
        defaultClient.basePath = host;
        // Configure Bearer (JWT) access token for authorization: API_Key
        var API_Key = defaultClient.authentications['API_Key'];
        API_Key.accessToken = "YOUR ACCESS TOKEN"

        var api = new FincuraApi.ApiKeyApi()
        var apikey = new FincuraApi.ApiKey();
        apikey.refresh_token = refreshToken;  
        apikey.tenant_id = tenantId;
        api.refreshApiKey({'apiKey': apikey}, (error, data, response) => {
            if (error) {
                console.error(error);
            } else {
                API_Key.accessToken = data['access_token']
                resolve(data);
            }
        });
    });
};



module.exports = {
    ensureAccessToken: ensureAccessToken
};
