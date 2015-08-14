var http = require("http");
var url = require("url");

module Manifesto {
    export class Utils {
        static load (manifestUri: string, cb: (manifest: any) => void): void {
            var u = url.parse(manifestUri);

            var fetch = http.request({
                host: u.hostname,
                port: u.port || 80,
                path: u.pathname,
                method: "GET",
                withCredentials: false
            }, (res) => {
                var result = "";
                res.on('data', (chunk) => {
                    result += chunk;
                });
                res.on('end', () => {
                    cb(result);
                });
            });

            fetch.end();
        }

        static loadExternalResource(resource: IExternalResource,
                     clickThrough: (resource: IExternalResource) => void,
                     login: (loginServiceUrl: string) => Promise<void>,
                     getAccessToken: (tokenServiceUrl: string) => Promise<IAccessToken>,
                     storeAccessToken: (resource: IExternalResource, token: IAccessToken) => Promise<void>,
                     getStoredAccessToken: (tokenServiceUrl: string) => Promise<IAccessToken>,
                     handleResourceResponse: (resource: IExternalResource) => Promise<any>,
                     options?: IManifestoOptions): Promise<IExternalResource> {

            return new Promise<any>((resolve, reject) => {

                if (options && options.pessimisticAccessControl){

                    // pessimistic: access control cookies may have been deleted.
                    // always request the access token for every access controlled info.json request
                    // returned access tokens are not stored, therefore the login window flashes for every request.

                    resource.getData().then(() => {
                        if (resource.isAccessControlled()){
                            // if the resource has a click through service, use that.
                            if (resource.clickThroughService){
                                resolve(clickThrough(resource));
                            } else {
                                login(resource.loginService.id).then(() => {
                                    getAccessToken(resource.tokenService.id).then((token: IAccessToken) => {
                                        resource.getData(token).then(() => {
                                            resolve(handleResourceResponse(resource));
                                        });
                                    });
                                });
                            }
                        } else {
                            // this info.json isn't access controlled, therefore no need to request an access token.
                            resolve(resource);
                        }
                    });
                } else {

                    // optimistic: access control cookies may not have been deleted.
                    // store access tokens to avoid login window flashes.
                    // if cookies are deleted a page refresh is required.

                    // try loading the resource using an access token that matches the info.json domain.
                    // if an access token is found, request the resource using it regardless of whether it is access controlled.
                    getStoredAccessToken(resource.dataUri).then((storedAccessToken: IAccessToken) => {
                        if (storedAccessToken) {
                            // try using the stored access token
                            resource.getData(storedAccessToken).then(() => {
                                // if the info.json loaded using the stored access token
                                if (resource.status === HTTPStatusCode.OK) {
                                    resolve(handleResourceResponse(resource));
                                } else {
                                    // otherwise, load the resource data to determine the correct access control services.
                                    // if access controlled, do login.
                                    Utils.authorize(
                                        resource,
                                        clickThrough,
                                        login,
                                        getAccessToken,
                                        storeAccessToken,
                                        getStoredAccessToken).then(() => {
                                            resolve(handleResourceResponse(resource));
                                        });
                                }
                            });
                        } else {
                            Utils.authorize(
                                resource,
                                clickThrough,
                                login,
                                getAccessToken,
                                storeAccessToken,
                                getStoredAccessToken).then(() => {
                                    resolve(handleResourceResponse(resource));
                                });
                        }
                    });
                }
            });
        }

        static loadExternalResources(resources: IExternalResource[],
                      clickThrough: (resource: IExternalResource) => void,
                      login: (loginServiceUrl: string) => Promise<void>,
                      getAccessToken: (tokenServiceUrl: string) => Promise<IAccessToken>,
                      storeAccessToken: (resource: IExternalResource, token: IAccessToken) => Promise<void>,
                      getStoredAccessToken: (tokenServiceUrl: string) => Promise<IAccessToken>,
                      handleResourceResponse: (resource: IExternalResource) => Promise<any>,
                      options?: IManifestoOptions): Promise<IExternalResource[]> {

            return new Promise<IExternalResource[]>((resolve) => {

                var promises = _map(resources, (resource: IExternalResource) => {
                    return Utils.loadExternalResource(
                        resource,
                        clickThrough,
                        login,
                        getAccessToken,
                        storeAccessToken,
                        getStoredAccessToken,
                        handleResourceResponse,
                        options);
                });

                Promise.all(promises)
                    .then(() => {
                        resolve(resources)
                    });
            });
        }

        static authorize(resource: IExternalResource,
                  clickThrough: (resource: IExternalResource) => void,
                  login: (loginServiceUrl: string) => Promise<void>,
                  getAccessToken: (tokenServiceUrl: string) => Promise<IAccessToken>,
                  storeAccessToken: (resource: IExternalResource, token: IAccessToken) => Promise<void>,
                  getStoredAccessToken: (tokenServiceUrl: string) => Promise<IAccessToken>): Promise<IExternalResource> {

            return new Promise<IExternalResource>((resolve, reject) => {

                resource.getData().then(() => {
                    if (resource.isAccessControlled()) {
                        getStoredAccessToken(resource.tokenService.id).then((storedAccessToken: IAccessToken) => {
                            if (storedAccessToken) {
                                // try using the stored access token
                                resource.getData(storedAccessToken).then(() => {
                                    resolve(resource);
                                });
                            } else {
                                if (resource.status === HTTPStatusCode.MOVED_TEMPORARILY && !resource.isResponseHandled) {
                                    // if the resource was redirected to a degraded version
                                    // and the response hasn't been handled yet.
                                    // if the client wishes to trigger a login, set resource.isResponseHandled to true
                                    // and call loadExternalResources() again.
                                    resolve(resource);
                                } else if (resource.clickThroughService){
                                    // if the resource has a click through service, use that.
                                    clickThrough(resource);
                                } else {
                                    // get an access token
                                    login(resource.loginService.id).then(() => {
                                        getAccessToken(resource.tokenService.id).then((accessToken) => {
                                            storeAccessToken(resource, accessToken).then(() => {
                                                resource.getData(accessToken).then(() => {
                                                    resolve(resource);
                                                });
                                            });
                                        });
                                    });
                                }
                            }
                        });
                    } else {
                        // this info.json isn't access controlled, therefore there's no need to request an access token
                        resolve(resource);
                    }
                });
            });
        }
    }
};